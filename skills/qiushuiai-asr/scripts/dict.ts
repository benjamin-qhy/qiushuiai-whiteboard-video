import { readFileSync } from "fs";
import type { SubtitleEntry } from "./types";

export type DictRule = { wrong: string; right: string };

export function parseDict(content: string): DictRule[] {
  const rules: DictRule[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(">") || line.startsWith("|")) continue;
    if (line.startsWith("```")) continue;
    const m = line.split(/\s*(?:→|->|=>)\s*/);
    if (m.length === 2 && m[0] && m[1]) rules.push({ wrong: m[0].trim(), right: m[1].trim() });
  }
  return rules;
}

export function loadDict(path: string): DictRule[] {
  return parseDict(readFileSync(path, "utf-8"));
}

export function applyDict(entries: SubtitleEntry[], rules: DictRule[]): { entries: SubtitleEntry[]; hits: number } {
  if (rules.length === 0) return { entries, hits: 0 };
  let hits = 0;
  const out = entries.map((e) => {
    let text = e.text;
    for (const r of rules) {
      if (!r.wrong) continue;
      const parts = text.split(r.wrong);
      if (parts.length > 1) {
        hits += parts.length - 1;
        text = parts.join(r.right);
      }
    }
    return { ...e, text };
  });
  return { entries: out, hits };
}
