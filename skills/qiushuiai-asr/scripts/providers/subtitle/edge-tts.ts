import { readFile, writeFile, unlink } from "fs/promises";
import type { SubtitleEntry, SubtitleOptions } from "../../types";

function parseSubTime(timeStr: string): number {
  // Handles both VTT (HH:MM:SS.mmm) and SRT (HH:MM:SS,mmm) formats
  const match = timeStr.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return (
    parseInt(h) * 3600000 +
    parseInt(m) * 60000 +
    parseInt(s) * 1000 +
    parseInt(ms)
  );
}

function parseSubtitleFile(content: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  const lines = content.split("\n");
  let i = 0;

  // Skip WEBVTT header if present
  while (i < lines.length && !lines[i].includes("-->")) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.includes("-->")) {
      const match = line.match(
        /(\d+:\d+:\d+[.,]\d+)\s+-->\s+(\d+:\d+:\d+[.,]\d+)/
      );
      if (match) {
        const startMs = parseSubTime(match[1]);
        const endMs = parseSubTime(match[2]);

        // Collect text lines until empty line
        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i].trim());
          i++;
        }

        if (textLines.length > 0) {
          entries.push({
            startMs,
            endMs,
            text: textLines.join(" "),
          });
        }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return entries;
}

function groupEntries(
  entries: SubtitleEntry[],
  wordsInCue: number
): SubtitleEntry[] {
  if (entries.length === 0) return [];

  // Each VTT entry from edge-tts is typically one word/phrase.
  // Group them into cues of wordsInCue entries each.
  const grouped: SubtitleEntry[] = [];

  for (let i = 0; i < entries.length; i += wordsInCue) {
    const group = entries.slice(i, i + wordsInCue);
    grouped.push({
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      text: group.map((e) => e.text).join(""),
    });
  }

  return grouped;
}

/**
 * Split long subtitle entries by punctuation when they exceed maxChars.
 * Time is distributed proportionally by character count.
 */
function splitLongEntries(
  entries: SubtitleEntry[],
  maxChars: number
): SubtitleEntry[] {
  if (maxChars <= 0) return entries;

  const result: SubtitleEntry[] = [];

  for (const entry of entries) {
    if (entry.text.length <= maxChars) {
      result.push(entry);
      continue;
    }

    // Split by Chinese and common punctuation, keeping the delimiter with the preceding segment
    const segments = entry.text
      .split(/(?<=[，。；：！？、,;:!?\n])/g)
      .filter((s) => s.length > 0);

    // Merge tiny segments to avoid overly short cues
    const merged: string[] = [];
    let buf = "";
    for (const seg of segments) {
      if (buf.length + seg.length <= maxChars) {
        buf += seg;
      } else {
        if (buf) merged.push(buf);
        buf = seg;
      }
    }
    if (buf) merged.push(buf);

    // If merging produced only one segment (no suitable punctuation to split on),
    // force-split at word boundaries (spaces) or maxChars as last resort
    if (merged.length <= 1) {
      const text = merged[0] || entry.text;
      const forced: string[] = [];
      let pos = 0;
      while (pos < text.length) {
        if (pos + maxChars >= text.length) {
          forced.push(text.slice(pos));
          break;
        }
        // Look for the last space within the maxChars window
        let splitAt = -1;
        for (let j = pos + maxChars; j > pos; j--) {
          if (text[j] === " ") {
            splitAt = j;
            break;
          }
        }
        if (splitAt > pos) {
          forced.push(text.slice(pos, splitAt));
          pos = splitAt + 1; // skip the space
        } else {
          // No space found, hard split at maxChars
          forced.push(text.slice(pos, pos + maxChars));
          pos += maxChars;
        }
      }
      merged.length = 0;
      merged.push(...forced);
    }

    // Distribute time proportionally by character count
    const totalChars = merged.reduce((sum, s) => sum + s.length, 0);
    const totalMs = entry.endMs - entry.startMs;
    let currentMs = entry.startMs;

    for (let i = 0; i < merged.length; i++) {
      const durationMs = Math.round((merged[i].length / totalChars) * totalMs);
      const endMs =
        i === merged.length - 1 ? entry.endMs : currentMs + durationMs;
      result.push({
        startMs: currentMs,
        endMs,
        text: merged[i],
      });
      currentMs = endMs;
    }
  }

  return result;
}

export async function generateSubtitles(
  options: SubtitleOptions
): Promise<SubtitleEntry[]> {
  const {
    text,
    voice = "zh-CN-YunxiNeural",
    rate,
    wordsInCue = 10,
    maxChars = 0,
  } = options;

  const tmpText = `/tmp/sub-input-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const tmpVtt = `/tmp/sub-output-${Date.now()}-${Math.random().toString(36).slice(2)}.vtt`;

  try {
    await writeFile(tmpText, text, "utf-8");

    const args = [
      "--file",
      tmpText,
      "--voice",
      voice,
      "--write-media",
      "/dev/null",
      "--write-subtitles",
      tmpVtt,
    ];

    if (rate) {
      args.push("--rate", rate);
    }

    const proc = Bun.spawn(["edge-tts", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain streams concurrently to keep event loop alive and prevent deadlock
    const drainStdout = Bun.readableStreamToText(proc.stdout).catch(() => "");
    const drainStderr = Bun.readableStreamToText(proc.stderr).catch(() => "");
    const [exitCode, , stderr] = await Promise.all([proc.exited, drainStdout, drainStderr]);
    if (exitCode !== 0) {
      throw new Error(
        `edge-tts subtitle generation failed (exit ${exitCode}): ${stderr}`
      );
    }

    const vttContent = await readFile(tmpVtt, "utf-8");
    const rawEntries = parseSubtitleFile(vttContent);
    const grouped = groupEntries(rawEntries, wordsInCue);
    return maxChars > 0 ? splitLongEntries(grouped, maxChars) : grouped;
  } finally {
    await unlink(tmpText).catch(() => {});
    await unlink(tmpVtt).catch(() => {});
  }
}
