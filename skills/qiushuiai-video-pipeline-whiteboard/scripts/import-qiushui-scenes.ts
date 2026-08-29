import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Plan, Scene, TimedCaption } from "./director";

type ImportedAsset = {
  index: number;
  title: string;
  promptFile: string;
  prompt: string;
  copyFile: string;
  copy: string;
  imageFile: string;
};

function normalize(value: string) {
  return value
    .replace(/^---[\s\S]*?---/g, "")
    .replace(/\s+/g, "")
    .replace(/[，。、“”‘’！？：；,.!?:;"'()\[\]{}<>《》【】\-]/g, "")
    .trim()
    .toLowerCase();
}

function titleFromFile(path: string) {
  return basename(path, extname(path))
    .replace(/^\d{2}-/, "")
    .replace(/-配图提示词$/, "")
    .replace(/-对应文案片段$/, "")
    .trim() || "未命名场景";
}

function promptStem(name: string) {
  return basename(name, ".md").replace(/-配图提示词$/, "");
}

function inferStructureType(title: string, prompt: string) {
  const text = `${title}\n${prompt}`;
  if (/(对比|比较|vs|区别|两边|一边)/i.test(text)) return "comparison";
  if (/(流程|步骤|路径|闭环|链路|飞轮)/i.test(text)) return "workflow";
  if (/(框架|能力栈|矩阵|系统|层级|模块)/i.test(text)) return "framework";
  if (/(时间线|阶段|演化|历程|先后)/i.test(text)) return "timeline";
  if (/(隐喻|像|比作|桥|阶梯|漏斗|杠杆|容器)/i.test(text)) return "metaphor";
  return "scene";
}

function buildBeats(startCaption: number, endCaption: number, cues: TimedCaption[]) {
  const total = endCaption - startCaption + 1;
  const beatCount = Math.max(1, Math.min(5, total <= 2 ? total : total <= 4 ? 2 : total <= 7 ? 3 : total <= 10 ? 4 : 5));
  const beats: Scene["beats"] = [];
  let cursor = startCaption;
  for (let i = 0; i < beatCount; i++) {
    const remainingCaptions = endCaption - cursor + 1;
    const remainingBeats = beatCount - i;
    const size = Math.max(1, Math.ceil(remainingCaptions / remainingBeats));
    const beatEnd = Math.min(endCaption, cursor + size - 1);
    beats.push({
      beat_number: i + 1,
      start_caption: cursor,
      end_caption: beatEnd,
      start_ms: cues[cursor - 1].startMs,
      end_ms: cues[beatEnd - 1].endMs,
      visual_addition: `补充第 ${i + 1} 层场景信息`,
      focal_element: `场景第 ${i + 1} 个焦点`,
      expression: i === 0 ? "draw" : i === beatCount - 1 ? "annotate" : "connect",
    });
    cursor = beatEnd + 1;
  }
  return beats;
}

function cueTimeline(cues: TimedCaption[], cursor: number) {
  let text = "";
  const cueByChar: number[] = [];
  for (let cueIndex = cursor; cueIndex < cues.length; cueIndex++) {
    const normalizedText = normalize(cues[cueIndex].text);
    for (const char of Array.from(normalizedText)) cueByChar.push(cueIndex);
    text += normalizedText;
  }
  return { text, cueByChar };
}

function locateByTrimmedSnippet(cues: TimedCaption[], target: string, cursor: number) {
  const { text, cueByChar } = cueTimeline(cues, cursor);
  if (!text) return null;
  const maxTrimStart = Math.min(48, Math.max(0, Math.floor(target.length * 0.35)));
  const maxTrimEnd = Math.min(32, Math.max(0, Math.floor(target.length * 0.22)));
  const minLength = Math.max(8, Math.floor(target.length * 0.55));
  for (let trimStart = 0; trimStart <= maxTrimStart; trimStart++) {
    for (let trimEnd = 0; trimEnd <= maxTrimEnd; trimEnd++) {
      const piece = target.slice(trimStart, target.length - trimEnd);
      if (piece.length < minLength) continue;
      const offset = text.indexOf(piece);
      if (offset < 0) continue;
      const firstCue = cueByChar[offset];
      const lastCue = cueByChar[offset + piece.length - 1];
      if (firstCue === undefined || lastCue === undefined) continue;
      return { start: firstCue, end: lastCue };
    }
  }
  return null;
}

export function locateCueRange(cues: TimedCaption[], snippet: string, cursor: number) {
  const target = normalize(snippet);
  if (!target) throw new Error("存在空的配图文案片段，无法映射字幕");
  const startHint = target.slice(0, Math.min(10, target.length));
  const endHint = target.slice(Math.max(0, target.length - Math.min(10, target.length)));
  for (let start = cursor; start < cues.length; start++) {
    let combined = "";
    for (let end = start; end < cues.length; end++) {
      combined += normalize(cues[end].text);
      if (!combined) continue;
      const enough = combined.length >= Math.max(8, Math.floor(target.length * 0.7));
      if ((combined.includes(startHint) && combined.includes(endHint) && enough) || combined.includes(target)) {
        return { start, end };
      }
      if (combined.length > target.length * 1.8 + 20) break;
    }
  }
  const fuzzyRange = locateByTrimmedSnippet(cues, target, cursor);
  if (fuzzyRange) return fuzzyRange;
  throw new Error(`无法为文案片段匹配字幕范围：${snippet.slice(0, 40)}`);
}

async function collectAssets(work: string) {
  const promptDir = join(work, "配图");
  const promptNames = (await readdir(promptDir)).filter((name) => /^\d{2}-.*-配图提示词\.md$/i.test(name)).sort();
  const copyNames = (await readdir(promptDir)).filter((name) => /^\d{2}-.*-对应文案片段\.md$/i.test(name)).sort();
  if (!promptNames.length) throw new Error(`缺少 qiushui ip 产出的配图提示词目录：${promptDir}`);
  if (promptNames.length !== copyNames.length) throw new Error(`配图提示词与对应文案片段数量不一致：${promptNames.length} vs ${copyNames.length}`);
  const assets: ImportedAsset[] = [];
  for (const promptName of promptNames) {
    const index = Number(promptName.slice(0, 2));
    const promptFile = join(promptDir, promptName);
    const stem = promptStem(promptName);
    const copyName = `${stem}-对应文案片段.md`;
    if (!copyNames.includes(copyName)) throw new Error(`缺少与 ${promptName} 对应的文案片段文件`);
    const imageFile = [".png", ".jpg", ".jpeg", ".webp"].map((ext) => join(work, `${stem}-配图${ext}`)).find((path) => existsSync(path));
    if (!imageFile) throw new Error(`缺少与 ${promptName} 对应的配图图片`);
    const copyFile = join(promptDir, copyName);
    assets.push({
      index,
      title: titleFromFile(promptFile),
      promptFile,
      prompt: (await readFile(promptFile, "utf8")).trim(),
      copyFile,
      copy: (await readFile(copyFile, "utf8")).trim(),
      imageFile,
    });
  }
  return assets.sort((a, b) => a.index - b.index);
}

export async function importQiushuiPlan(work: string, cues: TimedCaption[]): Promise<Plan> {
  const assets = await collectAssets(work);
  const scenes: Scene[] = [];
  let cursor = 0;
  for (const asset of assets) {
    const range = locateCueRange(cues, asset.copy, cursor);
    const startCaption = range.start + 1;
    const endCaption = range.end + 1;
    const narration = cues.slice(range.start, range.end + 1).map((cue) => cue.text).join("\n");
    const structure_type = inferStructureType(asset.title, asset.prompt);
    const scene = {
      index: asset.index,
      scene_number: asset.index,
      title: asset.title,
      summary: asset.copy.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 40) || asset.title,
      narration,
      description: asset.title,
      visualSetup: "使用 qiushui ip 已产出的配图作为本场白板主画面",
      visual_setup: "使用 qiushui ip 已产出的配图作为本场白板主画面",
      search_query: "",
      textOverlay: "",
      text_overlay: "",
      key_information: asset.copy.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || asset.title,
      emotional_beat: "steady",
      prompt: asset.prompt,
      start_caption: startCaption,
      end_caption: endCaption,
      start_ms: cues[range.start].startMs,
      end_ms: cues[range.end].endMs,
      beats: buildBeats(startCaption, endCaption, cues),
      structure_type,
      cut_reason: "切换到下一张 qiushui ip 已拆分出的核心配图",
      asset_prompt_file: asset.promptFile,
      asset_copy_file: asset.copyFile,
      asset_image: asset.imageFile,
    };
    scenes.push(scene as Scene);
    cursor = range.end + 1;
  }
  return {
    global_plan: {
      title: "qiushui ip imported storyboard",
      tone: "educational",
      narrative_persona: "qiushui ip",
      visual_style: "qiushui ip imported images",
      pacing: "follow imported scenes",
      narrative_arc: "按 qiushui ip 的拆图顺序推进",
      target_audience: "AI 知识类短视频观众",
      total_scenes: scenes.length,
      source: "qiushui-ip-assets",
    },
    scenes,
  };
}
