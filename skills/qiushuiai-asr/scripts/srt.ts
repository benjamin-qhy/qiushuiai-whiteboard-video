import type { SubtitleEntry } from "./types";

function msToSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "," +
    String(millis).padStart(3, "0")
  );
}

function stripTrailingPunctuation(text: string): string {
  // Remove trailing punctuation except question marks (? ？)
  return text.replace(/[，,、；;。.！!：:…]+$/u, "");
}

export function formatSrt(entries: SubtitleEntry[]): string {
  return entries
    .map(
      (entry, i) =>
        `${i + 1}\n${msToSrtTime(entry.startMs)} --> ${msToSrtTime(entry.endMs)}\n${stripTrailingPunctuation(entry.text)}`
    )
    .join("\n\n");
}
