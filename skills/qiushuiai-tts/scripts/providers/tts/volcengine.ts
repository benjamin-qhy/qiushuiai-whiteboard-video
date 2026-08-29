import type { TtsOptions, TtsResult, TtsSubtitleResult, TtsSubtitleWord } from "../../types";

const API_V1_URL = "https://openspeech.bytedance.com/api/v1/tts";
const API_V2_URL =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const MAX_TEXT_LENGTH_V1 = 1000;
const MAX_TEXT_LENGTH_V2 = 3000; // V2 大模型支持更长文本，减少 chunk 数量以消除拼接停顿

export function getDefaultVoice(): string {
  return (
    process.env.VOLCENGINE_TTS_SPK_ID || "zh_female_shuangkuai_moon_bigtts"
  );
}

function getConfig() {
  const appid = process.env.VOLCENGINE_TTS_APPID;
  const token = process.env.VOLCENGINE_TTS_TOKEN;
  const apiKey = process.env.VOLCENGINE_TTS_API_KEY || token;
  const cluster = process.env.VOLCENGINE_TTS_CLUSTER || "volcano_tts";

  if (!apiKey && (!appid || !token)) {
    throw new Error(
      "Volcengine TTS requires VOLCENGINE_TTS_API_KEY for the v3 API.\n" +
        "Set it in .qiushuiai-skills/.env or export it in your shell."
    );
  }

  return { appid, token, apiKey, cluster };
}

// Cloned voices use S_ prefix (speaker_id) or saturn_ prefix (icl_speaker_id)
function isClonedVoice(voice: string): boolean {
  return voice.startsWith("S_") || voice.startsWith("saturn_");
}

function splitTextByParagraphs(text: string, maxLen: number): string[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 1 > maxLen && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + para;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  if (chunks.length === 0 && text.trim()) {
    chunks.push(text.trim());
  }

  return chunks;
}

function parsePercentRate(rate?: string): number {
  if (!rate) return 0;
  const m = rate.match(/^([+-]?\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeSubtitleWord(item: any): TtsSubtitleWord | null {
  const text = item?.text ?? item?.word ?? item?.char ?? item?.phone;
  const start = item?.start_ms ?? item?.startTime ?? item?.start_time ?? item?.start ?? item?.begin_time;
  const end = item?.end_ms ?? item?.endTime ?? item?.end_time ?? item?.end ?? item?.stop_time;
  if (text == null || start == null || end == null) return null;
  let startMs = Number(start);
  let endMs = Number(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (startMs < 10000 && endMs < 10000) {
    startMs *= 1000;
    endMs *= 1000;
  }
  return { text: String(text), start_ms: startMs, end_ms: endMs };
}

function collectSubtitleWords(value: unknown, out: TtsSubtitleWord[] = []): TtsSubtitleWord[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) {
      const word = normalizeSubtitleWord(item);
      if (word) out.push(word);
      else collectSubtitleWords(item, out);
    }
    return out;
  }
  const obj = value as Record<string, unknown>;
  for (const key of ["subtitles", "subtitle", "sentence", "sentences", "words", "word_timestamps", "utterances"]) {
    if (key in obj) collectSubtitleWords(obj[key], out);
  }
  return out;
}

function extractAudioData(chunk: any): string | null {
  return chunk?.data ?? chunk?.audio ?? chunk?.payload?.data ?? chunk?.payload?.audio ?? null;
}

function extractSubtitlePayload(chunk: any): unknown | null {
  return chunk?.subtitle ?? chunk?.subtitles ?? chunk?.payload?.subtitle ?? chunk?.payload?.subtitles ?? null;
}

// V3 HTTP Chunked API: seed-icl-2.0 for cloned voices, seed-tts-2.0 for standard voices.
async function generateChunkV2(
  text: string,
  voice: string,
  config: { apiKey?: string },
  options: TtsOptions
): Promise<{ audio: Uint8Array; subtitles?: TtsSubtitleResult }> {
  const voiceType = options.volcengine?.voice_type || (isClonedVoice(voice) ? "cloned" : "standard");
  const resourceId =
    options.volcengine?.api_resource_id || (voiceType === "cloned" ? "seed-icl-2.0" : "seed-tts-2.0");
  const enableSubtitle = options.volcengine?.enable_subtitle ?? true;

  const body = {
    req_params: {
      text,
      model: options.volcengine?.model,
      speaker: voice,
      audio_params: {
        format: options.volcengine?.audio_format || "mp3",
        sample_rate: options.volcengine?.sample_rate || 24000,
        bit_rate: options.volcengine?.bit_rate,
        speech_rate: options.volcengine?.speech_rate ?? parsePercentRate(options.rate),
        loudness_rate: options.volcengine?.loudness_rate ?? 0,
        enable_subtitle: enableSubtitle,
      },
    },
  };

  const response = await fetch(API_V2_URL, {
    method: "POST",
    headers: {
      "X-Api-Key": config.apiKey || "",
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": crypto.randomUUID(),
      "Content-Type": "application/json",
      "X-Control-Require-Usage-Tokens-Return": "*",
      Connection: "keep-alive",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Volcengine TTS v3 API error: ${response.status} ${response.statusText}`
    );
  }

  const responseText = await response.text();
  const audioBuffers: Uint8Array[] = [];
  const subtitlePayloads: unknown[] = [];

  for (const line of responseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const chunk = JSON.parse(trimmed);
      const data = extractAudioData(chunk);
      if (data) audioBuffers.push(decodeBase64(data));
      const subtitle = extractSubtitlePayload(chunk) ?? chunk.sentence ?? chunk.sentences;
      if (subtitle) subtitlePayloads.push(subtitle);
      if (chunk.code === 20000000) break;
    } catch {
      // skip non-JSON lines
    }
  }

  if (audioBuffers.length === 0) throw new Error("No audio data in Volcengine v3 response");
  const rawSubtitle = subtitlePayloads.length === 1 ? subtitlePayloads[0] : subtitlePayloads;
  const words = collectSubtitleWords(rawSubtitle);
  return {
    audio: concatUint8Arrays(audioBuffers),
    subtitles: subtitlePayloads.length ? { raw: rawSubtitle, words: words.length ? words : undefined } : undefined,
  };
}

// V1.0 API: HTTP non-streaming — fallback or for standard voices
async function generateChunkV1(
  text: string,
  voice: string,
  config: { appid: string; token: string; cluster: string },
  _options: TtsOptions
): Promise<Uint8Array> {
  const cluster = isClonedVoice(voice) ? "volcano_icl" : config.cluster;

  const body = {
    app: {
      appid: config.appid,
      token: "access_token",
      cluster,
    },
    user: { uid: "qiushuiai-tts" },
    audio: {
      voice_type: voice,
      encoding: "mp3",
      speed_ratio: 1.0,
    },
    request: {
      reqid: crypto.randomUUID(),
      text,
      text_type: "plain",
      operation: "query",
      extra_param: JSON.stringify({ mute_cut_threshold: "400", mute_cut_remain_ms: "0" }),
    },
  };

  const response = await fetch(API_V1_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer; ${config.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Volcengine TTS v1.0 API error: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();

  if (result.code !== 3000) {
    throw new Error(
      `Volcengine TTS error (code ${result.code}): ${result.message || "unknown error"}`
    );
  }

  const audioBase64 = result.data;
  if (!audioBase64) {
    throw new Error("No audio data in volcengine response");
  }

  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
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
): Promise<TtsResult> {
  const config = getConfig();
  const useV2 = !!config.apiKey;
  const chunks = splitTextByParagraphs(
    text,
    useV2 ? MAX_TEXT_LENGTH_V2 : MAX_TEXT_LENGTH_V1
  );

  console.error(`Splitting text into ${chunks.length} chunk(s) for TTS...`);

  const audioBuffers: Uint8Array[] = [];
  const subtitlePayloads: unknown[] = [];
  const subtitleWords: TtsSubtitleWord[] = [];
  for (const chunk of chunks) {
    let audio: Uint8Array;

    if (useV2) {
      const result = await generateChunkV2(chunk, voice, config, options);
      audio = result.audio;
      if (result.subtitles) {
        subtitlePayloads.push(result.subtitles.raw);
        if (result.subtitles.words) subtitleWords.push(...result.subtitles.words);
      }
    } else {
      audio = await generateChunkV1(chunk, voice, config, options);
    }

    audioBuffers.push(audio);
  }

  const audio = concatUint8Arrays(audioBuffers);
  if (!subtitlePayloads.length) return audio;
  return {
    audio,
    subtitles: {
      raw: subtitlePayloads.length === 1 ? subtitlePayloads[0] : subtitlePayloads,
      words: subtitleWords.length ? subtitleWords : undefined,
    },
  };
}
