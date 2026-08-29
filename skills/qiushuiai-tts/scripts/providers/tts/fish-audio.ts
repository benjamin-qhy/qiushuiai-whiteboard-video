import type { TtsOptions } from "../../types";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

const TTS_URL = "https://api.fish.audio/v1/tts";

function getApiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) {
    throw new Error(
      "Fish Audio TTS provider requires FISH_AUDIO_API_KEY environment variable.\n" +
        "Set it in .qiushuiai-skills/.env or export it in your shell."
    );
  }
  return key;
}

export function getDefaultVoice(): string {
  return process.env.FISH_AUDIO_REFERENCE_ID || "";
}

// Convert rate string like "+30%" or "-10%" to prosody speed float
// Falls back to 1.0 if already provided explicitly or unparseable
function rateToSpeed(rate?: string): number | undefined {
  if (!rate || rate === "+0%") return undefined;
  const match = rate.match(/^([+-]?\d+(\.\d+)?)%$/);
  if (!match) return undefined;
  return 1.0 + parseFloat(match[1]) / 100;
}

function volumeToProsodyVolume(volume?: string): number | undefined {
  if (!volume || volume === "+0%") return undefined;
  const percentMatch = volume.match(/^([+-]?\d+(\.\d+)?)%$/);
  if (percentMatch) return parseFloat(percentMatch[1]) / 100;
  const numeric = Number(volume);
  if (!isNaN(numeric)) return numeric;
  return undefined;
}

// Split text into chunks at sentence boundaries, each <= maxChars
function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const sentenceEndRe = /[。！？!?\n]/g;

  let start = 0;

  while (start < text.length) {
    if (text.length - start <= maxChars) {
      const chunk = text.slice(start).trim();
      if (chunk) chunks.push(chunk);
      break;
    }

    sentenceEndRe.lastIndex = start;
    let breakPoint = -1;

    let match: RegExpExecArray | null;
    while ((match = sentenceEndRe.exec(text)) !== null) {
      if (match.index >= start + maxChars) break;
      breakPoint = match.index + 1;
    }

    if (breakPoint > start) {
      const chunk = text.slice(start, breakPoint).trim();
      if (chunk) chunks.push(chunk);
      start = breakPoint;
    } else {
      const chunk = text.slice(start, start + maxChars).trim();
      if (chunk) chunks.push(chunk);
      start += maxChars;
    }
  }

  return chunks;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export async function generateSpeech(
  text: string,
  voice: string,
  options: TtsOptions
): Promise<Uint8Array> {
  const apiKey = getApiKey();
  const fa = options.fishAudio ?? {};

  const chunkLength = fa.chunk_length ?? 200;
  const chunks = splitTextIntoChunks(text, chunkLength);

  // Build prosody: use explicit speed, or convert from rate string
  const speed = fa.speed ?? rateToSpeed(options.rate);
  const prosodyVolume = volumeToProsodyVolume(options.volume) ?? fa.prosody_volume;
  const hasProsody = speed !== undefined || prosodyVolume !== undefined;

  const audioChunks: Uint8Array[] = [];
  const chunkTrace: {
    index: number;
    char_count: number;
    byte_length: number;
    text: string;
  }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    const body: Record<string, unknown> = {
      text: chunk,
      format: "mp3",
      chunk_length: chunkLength,
    };

    if (voice) body.reference_id = voice;
    if (hasProsody) {
      const prosody: Record<string, number> = {};
      if (speed !== undefined) prosody.speed = speed;
      if (prosodyVolume !== undefined) prosody.volume = prosodyVolume;
      body.prosody = prosody;
    }
    if (fa.temperature !== undefined) body.temperature = fa.temperature;
    if (fa.top_p !== undefined) body.top_p = fa.top_p;
    if (fa.repetition_penalty !== undefined) body.repetition_penalty = fa.repetition_penalty;
    if (fa.mp3_bitrate !== undefined) body.mp3_bitrate = fa.mp3_bitrate;
    if (fa.latency !== undefined) body.latency = fa.latency;
    if (fa.normalize !== undefined) body.normalize = fa.normalize;

    const resp = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: "s2-pro",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(
        `Fish Audio TTS request failed (${resp.status}): ${errText}`
      );
    }

    const buffer = await resp.arrayBuffer();
    const audio = new Uint8Array(buffer);
    audioChunks.push(audio);
    chunkTrace.push({
      index: i + 1,
      char_count: chunk.length,
      byte_length: audio.byteLength,
      text: chunk,
    });
  }

  if (options.traceOutputPath) {
    await mkdir(dirname(options.traceOutputPath), { recursive: true });
    await writeFile(options.traceOutputPath, JSON.stringify({
      provider: "fish-audio",
      model: "s2-pro",
      voice: voice || "default",
      total_char_count: text.length,
      chunk_length: chunkLength,
      chunk_count: chunkTrace.length,
      request_options: {
        rate: options.rate,
        volume: options.volume,
        pitch: options.pitch,
        speed,
        prosody_volume: prosodyVolume,
        temperature: fa.temperature,
        top_p: fa.top_p,
        repetition_penalty: fa.repetition_penalty,
        mp3_bitrate: fa.mp3_bitrate,
        latency: fa.latency,
        normalize: fa.normalize,
      },
      chunks: chunkTrace,
    }, null, 2));
  }

  return concatUint8Arrays(audioChunks);
}
