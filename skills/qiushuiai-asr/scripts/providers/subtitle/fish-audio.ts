import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import type { SubtitleEntry, SubtitleOptions } from "../../types";

const ASR_URL = "https://api.fish.audio/v1/asr";

function getApiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) {
    throw new Error(
      "Fish Audio subtitle provider requires FISH_AUDIO_API_KEY environment variable."
    );
  }
  return key;
}

// Get audio duration in milliseconds using ffprobe
function getAudioDurationMs(audioFile: string): number | null {
  try {
    const result = spawnSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", audioFile],
      { encoding: "utf-8" }
    );
    if (result.status !== 0) return null;
    const info = JSON.parse(result.stdout);
    const duration = parseFloat(info?.format?.duration);
    if (isNaN(duration)) return null;
    return Math.round(duration * 1000);
  } catch {
    return null;
  }
}

// Call Fish Audio ASR via curl (multipart/form-data)
function callAsrViaCurl(
  audioFile: string,
  apiKey: string,
  language: string
): string {
  const result = spawnSync(
    "curl",
    [
      "-s",
      "-X", "POST",
      ASR_URL,
      "-H", `Authorization: Bearer ${apiKey}`,
      "-F", `audio=@${audioFile}`,
      "-F", `language=${language}`,
      "-F", "ignore_timestamps=false",
    ],
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(`curl ASR failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

// --- Fallback: proportion-based estimation ---

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/([。！？!?]+)/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildProportionalSubtitles(
  text: string,
  audioDurationMs: number,
  wordsInCue: number
): SubtitleEntry[] {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return [];

  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  const entries: SubtitleEntry[] = [];
  let currentMs = 0;

  const charsPerCue = Math.max(
    10,
    Math.round((totalChars / sentences.length) * wordsInCue)
  );
  let cueText = "";
  let cueStartMs = 0;

  for (const sentence of sentences) {
    if (cueText.length > 0 && cueText.length + sentence.length > charsPerCue) {
      const cueDurationMs = Math.round(
        (cueText.length / totalChars) * audioDurationMs
      );
      entries.push({
        startMs: cueStartMs,
        endMs: currentMs + cueDurationMs,
        text: cueText,
      });
      currentMs += cueDurationMs;
      cueStartMs = currentMs;
      cueText = sentence;
    } else {
      cueText += sentence;
    }
  }

  if (cueText.length > 0) {
    entries.push({
      startMs: cueStartMs,
      endMs: audioDurationMs,
      text: cueText,
    });
  }

  return entries;
}

// Split a long SubtitleEntry into smaller ones at punctuation boundaries,
// distributing the time range proportionally by character count.
function splitLongEntry(entry: SubtitleEntry, maxChars: number): SubtitleEntry[] {
  if (entry.text.length <= maxChars) return [entry];

  // Split at Chinese/English sentence-ending punctuation
  const parts = entry.text
    .replace(/([。！？!?,，、]+)/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Merge parts into cues of <= maxChars
  const cues: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current.length > 0 && current.length + part.length > maxChars) {
      cues.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) cues.push(current);

  if (cues.length <= 1) return [entry];

  // Distribute time proportionally by character count
  const totalChars = cues.reduce((sum, c) => sum + c.length, 0);
  const totalMs = entry.endMs - entry.startMs;
  const result: SubtitleEntry[] = [];
  let currentMs = entry.startMs;

  for (let i = 0; i < cues.length; i++) {
    const cueMs = i < cues.length - 1
      ? Math.round((cues[i].length / totalChars) * totalMs)
      : entry.endMs - currentMs;
    result.push({ startMs: currentMs, endMs: currentMs + cueMs, text: cues[i] });
    currentMs += cueMs;
  }

  return result;
}

// --- Main export ---

export async function generateSubtitles(
  options: SubtitleOptions
): Promise<SubtitleEntry[]> {
  const { text, wordsInCue = 10, maxChars = 0, audioFile } = options;

  if (audioFile) {
    try {
      const apiKey = getApiKey();
      console.error("Submitting audio to Fish Audio ASR...");
      const raw = callAsrViaCurl(audioFile, apiKey, "zh");
      const result = JSON.parse(raw);

      if (result.error) {
        throw new Error(`Fish Audio ASR error: ${result.error}`);
      }

      const segments: Array<{ text: string; start: number; end: number }> =
        result.segments ?? [];

      if (segments.length === 0) {
        throw new Error(
          `Fish Audio ASR returned no segments. Response: ${JSON.stringify(result).slice(0, 300)}`
        );
      }

      console.error(`ASR complete: ${segments.length} segments`);
      const entries: SubtitleEntry[] = segments.map((seg) => ({
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        text: seg.text,
      }));

      // Post-process: split long entries if maxChars is set
      if (maxChars > 0) {
        return entries.flatMap((e) => splitLongEntry(e, maxChars));
      }
      return entries;
    } catch (err: any) {
      console.error(
        `Fish Audio ASR failed: ${err.message}, falling back to proportion-based estimation`
      );
    }

    // Fallback: proportion-based estimation
    const audioDurationMs = getAudioDurationMs(audioFile);
    if (audioDurationMs && audioDurationMs > 0) {
      console.error(
        `Using proportion-based subtitle estimation (audio: ${(audioDurationMs / 1000).toFixed(1)}s)`
      );
      return buildProportionalSubtitles(text, audioDurationMs, wordsInCue);
    }
  }

  throw new Error(
    "Cannot generate subtitles: ASR failed and no audio duration available. Provide --output to enable ASR."
  );
}
