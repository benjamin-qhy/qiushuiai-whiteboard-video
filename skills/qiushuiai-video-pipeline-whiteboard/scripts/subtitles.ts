import { readFile, writeFile } from "node:fs/promises";

export type Cue = { index: number; startMs: number; endMs: number; text: string };
type TimedWord = { text?: string; word?: string; start_time?: number; end_time?: number; startTime?: number; endTime?: number };
type Utterance = { text?: string; start_time?: number; end_time?: number; startTime?: number; endTime?: number; words?: TimedWord[] };

function ms(value: string) {
  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) throw new Error(`字幕时间格式错误: ${value}`);
  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4].padEnd(3, "0").slice(0, 3));
}

function stamp(value: number) {
  const safe = Math.max(0, Math.round(value));
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  const n = safe % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(n).padStart(3, "0")}`;
}

export function parseSrt(content: string): Cue[] {
  return content.trim().split(/\r?\n\s*\r?\n/).map((block, position) => {
    const lines = block.split(/\r?\n/);
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) throw new Error(`字幕条目 ${position + 1} 缺少时间轴`);
    const [start, end] = lines[timing].split("-->").map((value) => value.trim());
    return { index: Number(lines[0]) || position + 1, startMs: ms(start), endMs: ms(end), text: lines.slice(timing + 1).join("\n").trim() };
  }).filter((cue) => cue.text);
}

export function serializeSrt(cues: Cue[]) {
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}`).join("\n\n") + "\n";
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function chars(value: string) {
  return Array.from(normalized(value));
}

function rawNormalizedPositions(value: string) {
  const result: { rawStart: number; rawEnd: number }[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}]/gu)) {
    const raw = match[0];
    const lowered = raw.toLowerCase();
    for (const char of Array.from(lowered)) result.push({ rawStart: match.index ?? 0, rawEnd: (match.index ?? 0) + raw.length });
  }
  return result;
}

function charAlignment(sourceChars: string[], targetChars: string[]) {
  if (!sourceChars.length || !targetChars.length) throw new Error("无法建立文本修正对齐关系");
  const width = targetChars.length + 1;
  const trace = new Uint8Array((sourceChars.length + 1) * width);
  let previous = new Uint32Array(width);
  let current = new Uint32Array(width);
  for (let j = 1; j <= targetChars.length; j++) previous[j] = j;
  for (let i = 1; i <= sourceChars.length; i++) {
    current[0] = i;
    for (let j = 1; j <= targetChars.length; j++) {
      const diagonal = previous[j - 1] + (sourceChars[i - 1] === targetChars[j - 1] ? 0 : 1);
      const remove = previous[j] + 1;
      const insert = current[j - 1] + 1;
      if (diagonal <= remove && diagonal <= insert) {
        current[j] = diagonal;
        trace[i * width + j] = 1;
      } else if (remove <= insert) {
        current[j] = remove;
        trace[i * width + j] = 2;
      } else {
        current[j] = insert;
        trace[i * width + j] = 3;
      }
    }
    [previous, current] = [current, previous];
  }
  const mapping = new Int32Array(sourceChars.length).fill(-1);
  let i = sourceChars.length;
  let j = targetChars.length;
  while (i > 0 || j > 0) {
    const direction = trace[i * width + j];
    if (i > 0 && j > 0 && direction === 1) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (j === 0 || direction === 2)) i--;
    else j--;
  }
  let last = -1;
  for (let index = 0; index < mapping.length; index++) {
    if (mapping[index] >= 0) last = mapping[index];
    else if (last >= 0) mapping[index] = last;
  }
  let next = targetChars.length - 1;
  for (let index = mapping.length - 1; index >= 0; index--) {
    if (mapping[index] >= 0) next = mapping[index];
    else mapping[index] = next;
  }
  return mapping;
}

function timedChars(content: string) {
  const utterances = JSON.parse(content) as Utterance[];
  return utterances.flatMap((utterance) => {
    const words = utterance.words?.length ? utterance.words : [{
      text: utterance.text,
      start_time: utterance.start_time ?? utterance.startTime,
      end_time: utterance.end_time ?? utterance.endTime,
    }];
    return words.flatMap((word) => {
      const rawText = word.text ?? word.word ?? "";
      const usesSecondFields = word.start_time === undefined && word.end_time === undefined;
      const start = word.start_time ?? word.startTime;
      const end = word.end_time ?? word.endTime;
      if (!rawText || typeof start !== "number" || typeof end !== "number") return [];
      const value = chars(rawText);
      if (!value.length) return [];
      const startMs = Math.round(usesSecondFields ? start * 1000 : start);
      const endMs = Math.round(usesSecondFields ? end * 1000 : end);
      const span = Math.max(1, endMs - startMs);
      return value.map((text, index) => ({
        text,
        startMs: Math.round(startMs + span * index / value.length),
        endMs: Math.round(startMs + span * (index + 1) / value.length),
      }));
    });
  });
}

function alignment(cues: Cue[], wordsContent: string) {
  const source = cues.flatMap((cue, cueIndex) => chars(cue.text).map((text) => ({ text, cueIndex })));
  const target = timedChars(wordsContent);
  if (!source.length || !target.length) throw new Error("无法建立字幕与字级时间轴的对应关系");
  const width = target.length + 1;
  const trace = new Uint8Array((source.length + 1) * width);
  let previous = new Uint32Array(width);
  let current = new Uint32Array(width);
  for (let j = 1; j <= target.length; j++) previous[j] = j;
  for (let i = 1; i <= source.length; i++) {
    current[0] = i;
    for (let j = 1; j <= target.length; j++) {
      const diagonal = previous[j - 1] + (source[i - 1].text === target[j - 1].text ? 0 : 1);
      const remove = previous[j] + 1;
      const insert = current[j - 1] + 1;
      if (diagonal <= remove && diagonal <= insert) {
        current[j] = diagonal;
        trace[i * width + j] = 1;
      } else if (remove <= insert) {
        current[j] = remove;
        trace[i * width + j] = 2;
      } else {
        current[j] = insert;
        trace[i * width + j] = 3;
      }
    }
    [previous, current] = [current, previous];
  }
  const mapping = new Int32Array(source.length).fill(-1);
  let i = source.length;
  let j = target.length;
  while (i > 0 || j > 0) {
    const direction = trace[i * width + j];
    if (i > 0 && j > 0 && direction === 1) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (j === 0 || direction === 2)) i--;
    else j--;
  }
  let last = -1;
  for (let index = 0; index < mapping.length; index++) {
    if (mapping[index] >= 0) last = mapping[index];
    else if (last >= 0) mapping[index] = last;
  }
  let next = target.length - 1;
  for (let index = mapping.length - 1; index >= 0; index--) {
    if (mapping[index] >= 0) next = mapping[index];
    else mapping[index] = next;
  }
  return { source, target, mapping };
}

export function retimeCues(cues: Cue[], wordsContent: string) {
  const { source, target, mapping } = alignment(cues, wordsContent);
  return cues.map((cue, cueIndex) => {
    const positions = source.map((item, index) => item.cueIndex === cueIndex ? mapping[index] : -1).filter((index) => index >= 0);
    if (!positions.length) return cue;
    return { ...cue, startMs: target[positions[0]].startMs, endMs: target[positions[positions.length - 1]].endMs };
  });
}

function splitDisplayUnits(value: string) {
  const units: string[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (/[A-Za-z0-9]/.test(char)) {
      let end = index + 1;
      while (end < value.length && /[A-Za-z0-9]/.test(value[end])) end++;
      units.push(value.slice(index, end));
      index = end;
      continue;
    }
    units.push(char);
    index++;
  }
  return units;
}

function stripDisplayPunctuation(value: string) {
  return value.replace(/[\p{P}\p{S}]+/gu, "").replace(/\s+/g, " ").trim();
}

function displayLength(value: string) {
  return Array.from(value.replace(/[\p{P}\p{S}\s]+/gu, "")).reduce((sum, char) => sum + (/^[\x00-\xff]$/.test(char) ? 0.5 : 1), 0);
}

type TextUnit = {
  raw: string;
  normalizedLength: number;
  startOffset: number;
  endOffset: number;
};

function cueUnits(text: string, baseOffset: number) {
  const units = splitDisplayUnits(text.trim());
  const result: TextUnit[] = [];
  let cursor = baseOffset;
  for (const raw of units) {
    const normalizedLength = chars(raw).length;
    result.push({
      raw,
      normalizedLength,
      startOffset: cursor,
      endOffset: cursor + normalizedLength,
    });
    cursor += normalizedLength;
  }
  return result;
}

export function segmentRenderCues(cues: Cue[], wordsContent: string, scriptText?: string) {
  const cueText = cues.map((cue) => cue.text).join("");
  const preferredText = scriptText && normalized(scriptText) === normalized(cueText) ? scriptText : cueText;
  const sourceCues = [{ index: 1, startMs: cues[0]?.startMs ?? 0, endMs: cues.at(-1)?.endMs ?? 0, text: preferredText }];
  const { source, target, mapping } = alignment(sourceCues, wordsContent);
  const units: TextUnit[] = [];
  let offset = 0;
  const displayBlocks = scriptText && normalized(scriptText) === normalized(cueText) ? [preferredText] : cues.map((cue) => cue.text);
  for (const text of displayBlocks) {
    units.push(...cueUnits(text, offset));
    offset += chars(text).length;
  }
  const result: Cue[] = [];
  let partStart = -1;
  let partLength = 0;
  const maxDisplayLength = 16;
  const maxDurationMs = 5500;
  const hasNearbyForcedBreak = (from: number) => {
    let distance = 0;
    for (let cursor = from + 1; cursor < units.length && distance <= 4; cursor++) {
      const candidate = units[cursor];
      if (candidate.raw.length === 1 && /[，。！？、!?]/.test(candidate.raw)) return true;
      distance += candidate.normalizedLength;
    }
    return false;
  };
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (partStart < 0) partStart = index;
    partLength += unit.normalizedLength;
    const forcedBreak = unit.raw.length === 1 && /[，。！？、!?]/.test(unit.raw);
    const next = units[index + 1];
    const currentText = units.slice(partStart, index + 1).map((item) => item.raw).join("");
    const maxLengthBreak = displayLength(currentText) >= maxDisplayLength && (!next || next.normalizedLength > 0) && !hasNearbyForcedBreak(index);
    const startUnitForDuration = units.slice(partStart, index + 1).find((item) => item.normalizedLength > 0);
    const endUnitForDuration = [...units.slice(partStart, index + 1)].reverse().find((item) => item.normalizedLength > 0);
    const firstForDuration = startUnitForDuration ? mapping[Math.min(startUnitForDuration.startOffset, source.length - 1)] : undefined;
    const lastForDuration = endUnitForDuration ? mapping[Math.min(endUnitForDuration.endOffset - 1, source.length - 1)] : undefined;
    const durationBreak = firstForDuration !== undefined && lastForDuration !== undefined && target[lastForDuration].endMs - target[firstForDuration].startMs >= maxDurationMs && (!next || next.normalizedLength > 0);
    const shouldFlush = forcedBreak || maxLengthBreak || durationBreak || !next;
    if (!shouldFlush) continue;
    let cut = index + 1;
    if (cut <= partStart) cut = partStart + 1;
    const segmentUnits = units.slice(partStart, cut);
    const rawText = segmentUnits.map((item) => item.raw).join("");
    const cleaned = stripDisplayPunctuation(rawText);
    const cleanedLength = chars(cleaned).length;
    if (cleaned && cleanedLength) {
      const startUnit = segmentUnits.find((item) => item.normalizedLength > 0);
      const endUnit = [...segmentUnits].reverse().find((item) => item.normalizedLength > 0);
      if (!startUnit || !endUnit) throw new Error(`无法为渲染字幕 ${result.length + 1} 提取字符范围`);
      const first = mapping[Math.min(startUnit.startOffset, source.length - 1)];
      const last = mapping[Math.min(endUnit.endOffset - 1, source.length - 1)];
      if (first === undefined || last === undefined) throw new Error(`无法为渲染字幕 ${result.length + 1} 建立字级时间`);
      result.push({ index: result.length + 1, text: cleaned, startMs: target[first].startMs, endMs: target[last].endMs });
    }
    partStart = cut;
    partLength = 0;
    index = cut - 1;
  }
  return result.filter((cue, index) => cue.text && cue.endMs > cue.startMs && (index === 0 || cue.startMs >= result[index - 1].endMs));
}

export function spokenScript(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split(/\r?\n/).filter((line) => !/^\s*#{1,6}\s+/.test(line)).join("\n").trim();
}

export function correctCueTextFromScript(cues: Cue[], scriptText: string) {
  const sourceText = cues.map((cue) => cue.text).join("");
  if (normalized(sourceText) === normalized(scriptText)) return { cues, changed: 0 };
  const sourceChars = chars(sourceText);
  const scriptChars = chars(scriptText);
  const scriptPositions = rawNormalizedPositions(scriptText);
  const mapping = charAlignment(sourceChars, scriptChars);
  let sourceOffset = 0;
  let changed = 0;
  const ranges = cues.map((cue) => {
    const length = chars(cue.text).length;
    const positions = Array.from(mapping.slice(sourceOffset, sourceOffset + length)).filter((index) => index >= 0);
    sourceOffset += length;
    return positions.length ? { start: Math.min(...positions), end: Math.max(...positions) } : null;
  });
  const corrected = cues.map((cue, cueIndex) => {
    const range = ranges[cueIndex];
    if (!range) return cue;
    const nextRange = ranges.slice(cueIndex + 1).find((item) => item);
    const startPosition = scriptPositions[range.start];
    const endRaw = nextRange ? scriptPositions[nextRange.start]?.rawStart : scriptText.length;
    if (!startPosition || typeof endRaw !== "number") return cue;
    const text = scriptText.slice(startPosition.rawStart, endRaw).replace(/\s+/g, " ").trim();
    if (!text || text === cue.text) return cue;
    changed++;
    return { ...cue, text };
  });
  const correctedText = corrected.map((cue) => cue.text).join("");
  if (normalized(correctedText) !== normalized(scriptText)) {
    throw new Error("无法把字幕文本自动修正到与视频.md完全一致，请人工定点审核字幕.srt");
  }
  return { cues: corrected, changed };
}

export async function reviewSubtitles(scriptPath: string, guidedPath: string, output: string) {
  const script = spokenScript(await readFile(scriptPath, "utf8"));
  const guided = parseSrt(await readFile(guidedPath, "utf8"));
  const correction = correctCueTextFromScript(guided, script);
  if (correction.changed) await writeFile(guidedPath, serializeSrt(correction.cues));
  const guidedText = correction.cues.map((cue) => cue.text).join("");
  const exact = normalized(guidedText) === normalized(script);
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  const report = `# 字幕审核\n\n> 审核时间：${now} ｜ 对比：视频.md ↔ 字幕.srt\n> 修改总数：${correction.changed} 条\n\n## 审核结论\n- ${exact ? "正式字幕已按视频.md校准；归一化后完全一致。" : "字幕.srt 与视频.md仍存在差异，必须人工或AI定点审核字幕；禁止修改视频.md。"}\n- 时间轴来自当前配音或所选字幕 provider，修正字幕时必须保持编号与时间轴不变。\n- 若 TTS/ASR 把术语转成错词，正式字幕文本以视频.md为准。\n`;
  await writeFile(output, report);
  if (!exact) throw new Error(`字幕审核未通过，请根据 ${output} 修正字幕.srt 后重跑`);
}

export function sceneSrt(cues: Cue[], startMs: number, endMs: number) {
  return serializeSrt(cues.filter((cue) => cue.endMs > startMs && cue.startMs < endMs).map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs - startMs),
    endMs: Math.min(endMs - startMs, cue.endMs - startMs),
  })));
}
