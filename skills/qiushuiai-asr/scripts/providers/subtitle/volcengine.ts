import { spawnSync } from "child_process";
import { readFileSync, statSync, writeFileSync } from "fs";
import type { SubtitleEntry, SubtitleOptions, VolcengineUtterance } from "../../types";

const ASR_SUBMIT_URL = "https://openspeech.bytedance.com/api/v1/vc/submit";
const ASR_QUERY_URL = "https://openspeech.bytedance.com/api/v1/vc/query";

function getConfig() {
  const appid = process.env.VOLCENGINE_TTS_APPID;
  const token = process.env.VOLCENGINE_TTS_TOKEN;

  if (!appid || !token) {
    throw new Error(
      "Volcengine subtitle provider requires VOLCENGINE_TTS_APPID and VOLCENGINE_TTS_TOKEN.\n" +
        "Set them in .qiushuiai-skills/qiushuiai-asr/CONFIG.md or as environment variables."
    );
  }

  return { appid, token };
}

// Cloned voices use S_ prefix (speaker_id) or saturn_ prefix (icl_speaker_id)
function isClonedVoice(voice: string): boolean {
  return voice.startsWith("S_") || voice.startsWith("saturn_");
}

// Get audio duration in milliseconds using ffprobe (fallback for proportion-based)
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

// --- ASR via Volcengine Voice Conversion API ---

// Use curl via spawnSync to avoid Bun fetch socket issues with large binary uploads
function curlPost(url: string, audioFile: string, token: string): string {
  const result = spawnSync(
    "curl",
    [
      "-s",
      "-X", "POST",
      url,
      "-H", `Authorization: Bearer; ${token}`,
      "-H", "Content-Type: audio/mpeg",
      "-H", "Connection: keep-alive",
      "--data-binary", `@${audioFile}`,
    ],
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(`curl failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

async function submitAsr(
  audioFile: string,
  config: { appid: string; token: string }
): Promise<string> {
  const params = new URLSearchParams({
    appid: config.appid,
    language: "zh-CN",
    words_per_line: "20",
    max_lines: "2",
    use_itn: "True",
    use_punc: "True",
    caption_type: "auto",
  });
  const url = `${ASR_SUBMIT_URL}?${params}`;

  const raw = curlPost(url, audioFile, config.token);
  const result = JSON.parse(raw);

  if (result.code !== 0) {
    throw new Error(
      `ASR submit error (code ${result.code}): ${result.message ?? raw}`
    );
  }

  const taskId = result.id;
  if (!taskId) {
    throw new Error(`ASR submit returned no task_id: ${raw}`);
  }

  return taskId;
}

async function queryAsr(
  taskId: string,
  config: { appid: string; token: string }
): Promise<{ subtitleEntries: SubtitleEntry[]; utterances: VolcengineUtterance[] }> {
  const authHeader = { Authorization: `Bearer; ${config.token}`, Connection: "keep-alive" };

  // First: blocking query (waits up to 300s server-side)
  const blockingUrl = `${ASR_QUERY_URL}?appid=${config.appid}&id=${taskId}&blocking=1`;
  const blockingResp = await fetch(blockingUrl, { headers: authHeader });

  if (!blockingResp.ok) {
    throw new Error(`ASR query failed: ${blockingResp.status} ${blockingResp.statusText}`);
  }

  let result = await blockingResp.json();

  // If still processing (code=2000), poll every 2s up to 30 times
  if (result.code === 2000) {
    const pollUrl = `${ASR_QUERY_URL}?appid=${config.appid}&id=${taskId}&blocking=0`;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollResp = await fetch(pollUrl, { headers: authHeader });
      if (!pollResp.ok) continue;
      result = await pollResp.json();
      if (result.code !== 2000) break;
    }
  }

  if (result.code !== 0) {
    throw new Error(
      `ASR query error (code ${result.code}): ${result.message ?? JSON.stringify(result)}`
    );
  }

  const rawUtterances: Array<{
    text: string;
    start_time: number;
    end_time: number;
    words?: Array<{ text: string; start_time: number; end_time: number; blank_duration?: number }>;
  }> = result.utterances ?? [];

  if (rawUtterances.length === 0) {
    throw new Error(`ASR returned no utterances. Response: ${JSON.stringify(result).slice(0, 300)}`);
  }

  const subtitleEntries: SubtitleEntry[] = rawUtterances.map((u) => ({
    startMs: u.start_time,
    endMs: u.end_time,
    text: u.text,
  }));

  const utterances: VolcengineUtterance[] = rawUtterances.map((u) => ({
    text: u.text,
    start_time: u.start_time,
    end_time: u.end_time,
    words: u.words ?? [],
  }));

  return { subtitleEntries, utterances };
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

// --- Main export ---

export async function generateSubtitles(
  options: SubtitleOptions
): Promise<SubtitleEntry[]> {
  const {
    text,
    voice = "zh_female_shuangkuai_moon_bigtts",
    wordsInCue = 10,
    audioFile,
    outputPrefix,
  } = options;

  const config = getConfig();

  // Use ASR when audioFile is available (works for any voice including cloned)
  if (audioFile) {
    try {
      console.error("Submitting audio to Volcengine ASR...");
      const taskId = await submitAsr(audioFile, config);
      console.error(`ASR task submitted (id: ${taskId}), waiting for result...`);
      const { subtitleEntries, utterances } = await queryAsr(taskId, config);
      console.error(`ASR complete: ${subtitleEntries.length} utterances`);

      // Save character-level words timestamps if outputPrefix is provided
      if (outputPrefix && utterances.some((u) => u.words.length > 0)) {
        const wordsPath = `${outputPrefix}.words.json`;
        writeFileSync(wordsPath, JSON.stringify(utterances, null, 2), "utf-8");
        const totalWords = utterances.reduce((n, u) => n + u.words.length, 0);
        console.error(`Words saved: ${wordsPath} (${totalWords} characters)`);
      }

      return subtitleEntries;
    } catch (err: any) {
      console.error(`ASR failed: ${err.message}, falling back to proportion-based estimation`);
    }
  }

  // Fallback: proportion-based estimation
  if (audioFile) {
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
