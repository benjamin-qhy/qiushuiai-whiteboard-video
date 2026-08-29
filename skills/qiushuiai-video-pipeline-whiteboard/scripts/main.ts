#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plan, type Scene } from "./director";
import { loadConfig } from "./config";
import { importQiushuiPlan } from "./import-qiushui-scenes";
import { parseSrt, retimeCues, reviewSubtitles, sceneSrt, segmentRenderCues, serializeSrt, spokenScript } from "./subtitles";

type Args = { workdir: string; force: boolean; approveImages: boolean; phase: "audio" | "images" | "render" | "finalize" | "all"; scene?: number; imageProvider?: string; ttsProvider?: string; asrProvider?: string };
const DEFAULT_SAM_API_URL = "http://localhost:8000";

function usage() {
  console.log(`Usage: qiushuiai-video-pipeline-whiteboard --workdir <作品目录> [options]

把 视频.md 制作为多场景白板手绘视频。开源版本不内置标题/标签生成；
若 标题.md 存在会复用封面标题，否则从 视频.md 提取兜底标题。

Options:
  --workdir, --dir <path>      作品目录，至少包含 视频.md
  --phase <name>               audio | images | render | finalize | all（默认 images）
  --scene <n>                  只处理指定场景
  --force                      重新生成可复用阶段
  --image-provider <name>      传递给图像生成兜底层的 provider 名称
  --tts-provider <name>        TTS provider: fish-audio | volcengine | edge-tts
  --asr-provider <name>        ASR provider: fish-audio | volcengine | edge-tts
  --approve-images             兼容旧调用，当前版本不维护确认状态
  --help, -h                   显示帮助

Typical flow:
  bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase images
  bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render
  bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase finalize`);
}

function coverFilename(ratio: "16:9" | "9:16") {
  return ratio === "16:9" ? "封面-横版-16x9.png" : "封面-竖版-9x16.png";
}

function args(): Args {
  const values = process.argv.slice(2);
  if (values.includes("--help") || values.includes("-h")) {
    usage();
    process.exit(0);
  }
  let workdir = "";
  const out: Args = { workdir, force: false, approveImages: false, phase: "images" };
  for (let i = 0; i < values.length; i++) {
    if (values[i] === "--workdir" || values[i] === "--dir") out.workdir = values[++i];
    else if (values[i] === "--force") out.force = true;
    else if (values[i] === "--approve-images") out.approveImages = true;
    else if (values[i] === "--phase") out.phase = values[++i] as Args["phase"];
    else if (values[i] === "--scene") out.scene = Number(values[++i]);
    else if (values[i] === "--image-provider") out.imageProvider = values[++i];
    else if (values[i] === "--tts-provider") out.ttsProvider = values[++i];
    else if (values[i] === "--asr-provider") out.asrProvider = values[++i];
  }
  if (!out.workdir) throw new Error("需要 --workdir <作品目录>");
  if (!["audio", "images", "render", "finalize", "all"].includes(out.phase)) throw new Error(`未知阶段: ${out.phase}`);
  return out;
}

async function spawn(cmd: string[], cwd?: string) {
  const proc = Bun.spawn(cmd, { cwd, env: process.env, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code) throw new Error(`${cmd[0]} 执行失败 (${code})`);
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function duration(path: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], { stdout: "pipe" });
  const value = await new Response(proc.stdout).text();
  if (await proc.exited) throw new Error(`无法读取媒体时长: ${path}`);
  return Number(value.trim());
}

async function probeVideo(path: string) {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate",
    "-of", "json",
    path,
  ], { stdout: "pipe" });
  const text = await new Response(proc.stdout).text();
  if (await proc.exited) throw new Error(`无法读取视频信息: ${path}`);
  const parsed = JSON.parse(text) as { streams?: Array<{ width: number; height: number; avg_frame_rate: string; r_frame_rate: string }> };
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error(`视频缺少可用的视频流: ${path}`);
  const rate = stream.r_frame_rate || stream.avg_frame_rate || "25/1";
  const [num, den] = String(rate).split("/").map(Number);
  const fps = num && den ? num / den : 25;
  return { width: stream.width, height: stream.height, fps: fps > 0 ? fps : 25 };
}

async function burnFullSubtitles(video: string, subtitle: string, output: string) {
  await spawn([
    "ffmpeg", "-y",
    "-i", video,
    "-vf", `subtitles=${subtitle}:force_style='FontName=Heiti SC,FontSize=18,Outline=0.6,Shadow=0,PrimaryColour=&HFFFFFF&,MarginV=22'`,
    "-map", "0:v",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-c:a", "copy",
    "-pix_fmt", "yuv420p",
    output,
  ]);
}

async function isSamHealthy(url: string) {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function parseFrontmatterScalars(content: string) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return {};
  const out: Record<string, string | number | boolean> = {};
  const stack: string[] = [];
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^(\s*)([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2];
    const raw = (match[3] || "").trim();
    stack.splice(Math.floor(indent / 2));
    if (!raw) {
      stack[Math.floor(indent / 2)] = key;
      continue;
    }
    const path = [...stack, key].join(".");
    const scalar = raw.replace(/^['"]|['"]$/g, "");
    out[path] = /^-?\d+(?:\.\d+)?$/.test(scalar) ? Number(scalar) : scalar;
  }
  return out;
}

async function readTtsTrace(work: string, overrideProvider?: string) {
  const candidates = [
    join(process.cwd(), ".qiushuiai-skills/qiushuiai-tts/CONFIG.md"),
    join(work, ".qiushuiai-skills/qiushuiai-tts/CONFIG.md"),
  ];
  let configPath: string | null = null;
  let values: Record<string, string | number | boolean> = {};
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    configPath = candidate;
    values = parseFrontmatterScalars(await readFile(candidate, "utf8"));
    break;
  }
  return {
    provider: overrideProvider || values.provider || null,
    voice: values.voice || values["volcengine.speaker"] || values["volcengine.spk_id"] || null,
    rate: values.rate || null,
    volcengine: {
      speaker: values["volcengine.speaker"] || values["volcengine.spk_id"] || null,
      voice_type: values["volcengine.voice_type"] || null,
      api_resource_id: values["volcengine.api_resource_id"] || null,
      model: values["volcengine.model"] || null,
      speech_rate: values["volcengine.speech_rate"] ?? null,
      loudness_rate: values["volcengine.loudness_rate"] ?? null,
      sample_rate: values["volcengine.sample_rate"] ?? null,
      enable_subtitle: values["volcengine.enable_subtitle"] ?? null,
    },
    config_path: configPath,
    override_provider: overrideProvider || null,
  };
}

async function readSamSceneTrace(scenes: Scene[], work: string) {
  const items = [];
  for (const scene of scenes) {
    const id = String(scene.index).padStart(2, "0");
    const metricsPath = join(work, "scene", `scene-${id}`, "绘制参数.json");
    const segmentationPath = join(work, "scene", `scene-${id}`, "分层蒙版.json");
    let metrics: any = {};
    if (existsSync(metricsPath)) {
      try {
        metrics = JSON.parse(await readFile(metricsPath, "utf8"));
      } catch {}
    }
    items.push({
      scene: scene.index,
      segmentation_file: existsSync(segmentationPath) ? segmentationPath : null,
      metrics_file: existsSync(metricsPath) ? metricsPath : null,
      ordered_layers_count: metrics.ordered_layers_count ?? null,
      first_layer: Array.isArray(metrics.ordered_layer_names) ? metrics.ordered_layer_names[0] || null : null,
      title_first: Array.isArray(metrics.ordered_layer_names) ? metrics.ordered_layer_names[0] === "title area" : null,
      sam3_mask_groups_count: metrics.sam3_mask_groups_count ?? null,
    });
  }
  return items;
}

function cleanTitle(value: string) {
  return value.replace(/^[「“"'#\s]+|[」”"'\s]+$/g, "").trim();
}

function inferCoverExpression(title: { line1: string; line2: string }, scene: Scene) {
  const text = `${title.line1} ${title.line2} ${scene.summary} ${scene.key_information} ${scene.description}`;
  if (/(风险|危险|别|不要|不能|复核|校验|确认|喊停|no go|判断)/i.test(text)) return "判断 / 风险提醒型";
  if (/(为什么|怎么|拆解|解释|原理|区别|流程|结构)/i.test(text)) return "解释 / 拆解型";
  return "解释 / 拆解型";
}

function fallbackCoverTitle(script: string) {
  const title = script.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  return { line1: cleanTitle(title || "白板视频"), line2: "" };
}

function parseCoverTitle(content: string) {
  const block = content.match(/###\s*封面标题[\s\S]*?(?:-+\s*line1[:：]\s*[「“"]?(.+?)[」”"]?\s*\n)(?:-+\s*line2[:：]\s*[「“"]?(.+?)[」”"]?\s*(?:\n|$))?/);
  if (!block) return null;
  const line1 = cleanTitle(block[1] || "");
  const line2 = cleanTitle(block[2] || "");
  if (!line1) return null;
  return { line1, line2 };
}

type CoverVariant = {
  pose: string;
  wardrobe: string;
  prop: string;
  negativePose: string;
};

function stableIndex(seed: string, modulo: number) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % modulo;
}

function selectCoverVariant(work: string, title: { line1: string; line2: string }, scene: Scene, expression: string): CoverVariant {
  const seed = `${work}\n${title.line1}\n${title.line2}\n${scene.summary}\n${expression}`;
  const poses = [
    "双手微展开，像在对比两个选项或解释两种路径，手指自然放松，不做竖直食指动作",
    "一手拿黑色签字笔，另一只手自然打开做讲解，身体轻微侧向标题区",
    "一手托下巴做思考判断，另一只手自然放在身前，表情认真但不夸张",
    "一手拿小卡片或便签，另一只手掌心向上做说明，像在拆解一个重点",
    "双手在胸前做分层拆解手势，手掌打开，像在把复杂问题分成几层",
    "一手拿平板或薄本，另一只手轻抬做提醒，手掌打开而不是食指上指",
    "轻微前倾看向镜头，双手自然放在画面下方，靠表情和标题形成重点感",
    "半转身回看镜头，一只手以开放手掌指向旁边结构图，不使用单指上指",
  ];
  const wardrobes = [
    "浅蓝色长袖 T 恤，纯色、无大 logo、质感干净",
    "白色短袖 Polo，简洁商务休闲，不带外套",
    "深灰色细针织衫，内搭质感，理性可信",
    "米白色轻薄衬衫，领口简洁，不像正式西装衬衫",
    "海军蓝长袖 T 恤，低饱和纯色，干净利落",
    "浅灰色 Polo，商务休闲，适合知识创作者",
    "暖白色针织衫，柔和但不随便，禁止外套",
    "浅绿色简洁短袖 T 恤，低饱和、无图案、无大 logo",
  ];
  const props = [
    "可以出现一支笔作为轻道具",
    "可以出现一张小卡片作为轻道具",
    "可以出现一台平板作为轻道具",
    "不需要额外道具，靠手势和主题结构表达",
  ];
  return {
    pose: poses[stableIndex(`${seed}:pose`, poses.length)],
    wardrobe: wardrobes[stableIndex(`${seed}:wardrobe`, wardrobes.length)],
    prop: props[stableIndex(`${seed}:prop`, props.length)],
    negativePose: "禁止右手食指竖直向上指，禁止单手食指指天，禁止连续复用知识博主常见的单指上指姿势。",
  };
}

async function writeCoverPrompt(path: string, aspect: "16:9" | "9:16", title: { line1: string; line2: string }, scene: Scene, expression: string, variant: CoverVariant) {
  const contentArea = aspect === "16:9" ? "4:3" : "3:4";
  const prompt = [
    `为一条 AI 知识类短视频生成 ${aspect} 封面图。`,
    `最终交付画布必须是 ${aspect}，但标题、人物主体和所有关键信息必须收在画面垂直居中的 ${contentArea} 内容安全区内。`,
    aspect === "16:9"
      ? "横版 16:9 画布左右两侧只能作为背景延展、氛围留白或弱装饰，不得放置关键文字、人物脸部或核心主体。"
      : "竖版 9:16 画布顶部和底部只能作为背景延展、氛围留白或弱装饰，不得放置关键文字、人物脸部或核心主体。",
    "这是一张 subject-led 的知识类短视频封面，不是视频帧截图，也不是纯标题图。",
    "优先出现主讲人本人；若本次没有提供身份参考图，则可改为知识类视频封面的通用主讲人主体。",
    "若提供身份参考图，必须严格参考该图，保留同一人物身份识别特征，包括发型、发际线、脸型、五官比例、眼镜样式和整体气质，不得换成陌生人。",
    "身份参考图只用于锁定主讲人身份，不要把首场画面或配图作为图像参考；视频主题只通过标题、内容摘要和简洁主题元素表达。",
    "人物必须像知识视频封面中的主讲人，而不是站桩头像、证件照、路人或纯插画符号。",
    "纯中文封面，标题文字必须直接烘焙进图片，不做后期叠字。",
    `主标题：${title.line1 || "白板视频"}`,
    title.line2 ? `副标题：${title.line2}` : "副标题可省略；如保留，必须明显小于主标题。",
    `内容表达类型：${expression}。`,
    `封面主题参考首场内容：${scene.summary}。`,
    `首场关键表达：${scene.key_information}。`,
    `首场核心画面：${scene.description}。`,
    "画面必须适合手机观看：标题大、清晰、高对比，信息层次明确，避免小字和密集文字。",
    "只允许 1 个主标题和可选 1 行副标题，严禁段落文字、项目列表、密集标注。",
    "人物表情默认使用标准型，偏认真、判断感、提醒感，可以有轻微强调，但不能夸张到失真或变脸。",
    `本次人物姿势必须使用：${variant.pose}。`,
    variant.negativePose,
    `本次服装必须使用：${variant.wardrobe}。`,
    "服装必须是商务休闲内搭，严禁西装外套、夹克、风衣、大衣等任何外套；不得默认沿用头像参考图中的衣服。",
    variant.prop,
    "避免摄影写实，避免深色脏背景，避免复杂纹理，避免低对比，避免无人纯字图。",
    "优先使用简洁有冲击力的主视觉：一个明确人物主体，加一个与主题相关的结构或风险信号，留出标题安全区。",
    aspect === "16:9"
      ? "横屏封面，人物建议位于右侧或右中区域，标题区留在左侧或中上区域，保证左侧文字清晰可读。"
      : "竖屏封面，人物建议位于中下部偏右或中部偏右，标题位于上半区，避开底部平台按钮遮挡区。",
    "风格：知识类视频封面、清晰、现代、强可读性、适合社交平台首屏点击。",
  ].join("\n");
  await writeFile(path, `${prompt}\n`);
}

async function prepareCoverRequest(work: string, scenes: Scene[], force: boolean) {
  const titleFile = join(work, "标题.md");
  const script = await readFile(join(work, "视频.md"), "utf8");
  const title = existsSync(titleFile) ? parseCoverTitle(await readFile(titleFile, "utf8")) || fallbackCoverTitle(script) : fallbackCoverTitle(script);
  const firstScene = scenes[0];
  const coverDir = join(work, "封面");
  await ensureDir(coverDir);
  const prompt16x9 = join(coverDir, "cover-16x9.md");
  const prompt9x16 = join(coverDir, "cover-9x16.md");
  const coverWide = join(work, coverFilename("16:9"));
  const coverTall = join(work, coverFilename("9:16"));
  const identityRef = resolve(work, "00-约定", "头像.png");
  const coverRulesFile = resolve(work, "00-约定", "封面生成约定.md");
  const expression = inferCoverExpression(title, firstScene);
  const coverVariant = selectCoverVariant(work, title, firstScene, expression);
  await writeCoverPrompt(prompt16x9, "16:9", title, firstScene, expression, coverVariant);
  await writeCoverPrompt(prompt9x16, "9:16", title, firstScene, expression, coverVariant);
  await writeFile(join(coverDir, "封面文案.json"), JSON.stringify({
    title,
    content_type: expression,
    cover_variant: coverVariant,
    first_scene: {
      index: firstScene.index,
      summary: firstScene.summary,
      key_information: firstScene.key_information,
      description: firstScene.description,
    },
  }, null, 2));
  await writeFile(join(coverDir, "封面生成说明.md"), [
    "# 封面生成说明",
    "",
    `- 主标题：${title.line1 || "白板视频"}`,
    `- 副标题：${title.line2 || "无"}`,
    `- 表达类型：${expression}`,
    `- 首场主题：${firstScene.summary}`,
    `- 首场关键表达：${firstScene.key_information}`,
    `- 首场核心画面：${firstScene.description}`,
    `- 本次姿势：${coverVariant.pose}`,
    `- 本次服装：${coverVariant.wardrobe}`,
    `- 姿势禁用：${coverVariant.negativePose}`,
  ].join("\n"));
  if (force && existsSync(coverWide)) await rm(coverWide, { force: true });
  if (force && existsSync(coverTall)) await rm(coverTall, { force: true });
  const requestPath = join(coverDir, "cover-request.json");
  await writeFile(requestPath, JSON.stringify({
    skill: "qiushuiai-video-cover",
    platform: "generic",
    aspect: "both",
    form: "subject-led",
    text_level: title.line2 ? "title-subtitle" : "title-only",
    cover_mode: "subject-led",
    must_use_identity_ref: existsSync(identityRef),
    content_type: expression,
    cover_rules_file: existsSync(coverRulesFile) ? coverRulesFile : null,
    title,
    pose_variant: coverVariant.pose,
    wardrobe_variant: coverVariant.wardrobe,
    prop_variant: coverVariant.prop,
    negative_pose: coverVariant.negativePose,
    reference_images: [identityRef].filter((path) => existsSync(path)),
    identity_ref: existsSync(identityRef) ? identityRef : null,
    scene_ref: null,
    outputs: {
      wide: coverWide,
      tall: coverTall,
    },
    prompt_files: {
      wide: prompt16x9,
      tall: prompt9x16,
    },
  }, null, 2));
  return { coverWide, coverTall, requestPath };
}

async function mergeCoverIntoFirstFrame(video: string, coverWide: string, coverTall: string, output: string, work: string) {
  const info = await probeVideo(video);
  const cover = info.width >= info.height ? coverWide : coverTall;
  if (!existsSync(cover)) throw new Error(`缺少封面文件: ${cover}`);
  const coverFrame = join(work, "封面", "cover-first-frame.png");
  const frameDuration = 1 / info.fps;
  await spawn([
    "ffmpeg", "-y", "-i", cover,
    "-vf", `scale=${info.width}:${info.height}:force_original_aspect_ratio=increase,crop=${info.width}:${info.height}`,
    "-frames:v", "1",
    "-update", "1",
    coverFrame,
  ]);
  await spawn([
    "ffmpeg", "-y",
    "-loop", "1", "-i", coverFrame,
    "-i", video,
    "-filter_complex",
    `[0:v]fps=${info.fps},trim=duration=${frameDuration},setpts=PTS-STARTPTS[cover];` +
    `[1:v]trim=start_frame=1,setpts=PTS-STARTPTS[tail];` +
    `[cover][tail]concat=n=2:v=1:a=0[v]`,
    "-map", "[v]",
    "-map", "1:a?",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    output,
  ]);
}

function visualOutline(plan: Plan) {
  const lines = ["# 视觉场景大纲", ""];
  for (const scene of plan.scenes) {
    lines.push(`## 场景 ${scene.index}：${scene.summary}`);
    lines.push(`- 字幕范围：${scene.start_caption}–${scene.end_caption}`);
    lines.push(`- 真实时间：${(scene.start_ms / 1000).toFixed(2)}s–${(scene.end_ms / 1000).toFixed(2)}s`);
    lines.push(`- 认知锚点：${scene.key_information}`);
    lines.push(`- 结构类型：${(scene as any).structure_type || "scene"}`);
    lines.push(`- 核心画面：${scene.description}`);
    lines.push(`- 构图：${scene.visual_setup}`);
    lines.push(`- 画面文字：${scene.text_overlay || "无"}`);
    lines.push(`- 切场原因：${(scene as any).cut_reason || "进入下一个认知锚点"}`);
    lines.push("- 场内绘制节拍：");
    for (const beat of scene.beats || []) lines.push(`  - Beat ${beat.beat_number}｜字幕 ${beat.start_caption}–${beat.end_caption}｜${(beat.start_ms / 1000).toFixed(2)}s–${(beat.end_ms / 1000).toFixed(2)}s｜${beat.expression}｜新增：${beat.visual_addition}｜焦点：${beat.focal_element}`);
    lines.push("");
  }
  return lines.join("\n");
}

function normalizeNarration(value: string) {
  return value.replace(/\s+/g, "");
}

async function loadPlanFromDisk(planPath: string) {
  const saved = JSON.parse(await readFile(planPath, "utf8"));
  return Array.isArray(saved) ? { global_plan: {}, scenes: saved } : saved;
}

async function hydratePlanPrompts(work: string, plan: Plan) {
  const changedPrompts = new Set<number>();
  for (const scene of plan.scenes) {
    const id = String(scene.index).padStart(2, "0");
    const sceneDir = join(work, "scene", `scene-${id}`);
    await ensureDir(sceneDir);
    const promptPath = join(sceneDir, "分镜提示词.md");
    const diskPrompt = existsSync(promptPath) ? await readFile(promptPath, "utf8") : "";
    const nextPrompt = diskPrompt.trim() || scene.prompt;
    if (diskPrompt && diskPrompt !== scene.prompt) changedPrompts.add(scene.index);
    scene.prompt = nextPrompt;
    await writeFile(promptPath, `${nextPrompt.trim()}\n`);
  }
  return changedPrompts;
}

async function writeSceneArtifacts(work: string, plan: Plan) {
  const sceneRoot = join(work, "scene");
  await ensureDir(sceneRoot);
  await writeFile(join(sceneRoot, "分镜计划.json"), JSON.stringify(plan, null, 2));
  await writeFile(join(sceneRoot, "视觉场景大纲.md"), visualOutline(plan));
  for (const scene of plan.scenes) {
    const id = String(scene.index).padStart(2, "0");
    const sceneDir = join(sceneRoot, `scene-${id}`);
    await ensureDir(sceneDir);
    await writeFile(join(sceneDir, "信息卡.json"), JSON.stringify({
      index: scene.index,
      scene_number: scene.scene_number,
      title: scene.title,
      summary: scene.summary,
      narration: scene.narration,
      description: scene.description,
      visual_setup: scene.visual_setup,
      text_overlay: scene.text_overlay,
      key_information: scene.key_information,
      emotional_beat: scene.emotional_beat,
      prompt_file: join(sceneDir, "分镜提示词.md"),
      image: join(sceneDir, "画面.png"),
      subtitle: join(sceneDir, "字幕.srt"),
      audio: join(sceneDir, "配音.mp3"),
      start_caption: scene.start_caption,
      end_caption: scene.end_caption,
      start_ms: scene.start_ms,
      end_ms: scene.end_ms,
      beats: scene.beats,
    }, null, 2));
    await writeFile(join(sceneDir, "绘制顺序.json"), JSON.stringify({
      scene: scene.index,
      title: scene.title || scene.summary,
      note: "渲染阶段优先按 分层蒙版.json 的 ordered_layers 执行；本文件用于人工审核标题与文案 beat 的绘制意图。",
      draw_sequence: [
        {
          order: 1,
          type: "title",
          name: "画面标题",
          method: "region",
          region: "top-left title area",
          reason: "所有白板场景先建立当前画面主题。",
        },
        ...(scene.beats || []).map((beat, index) => ({
          order: index + 2,
          type: "beat",
          name: beat.focal_element || beat.visual_addition || `Beat ${beat.beat_number}`,
          method: "sam3-or-region",
          caption_range: `${beat.start_caption}-${beat.end_caption}`,
          reason: beat.visual_addition,
        })),
      ],
    }, null, 2));
    await writeFile(join(sceneDir, "分镜.md"), [
      `# 场景 ${scene.index}：${scene.summary}`,
      "",
      `- 标题：${scene.title || "未命名场景"}`,
      `- 字幕范围：${scene.start_caption}–${scene.end_caption}`,
      `- 真实时间：${(scene.start_ms / 1000).toFixed(2)}s–${(scene.end_ms / 1000).toFixed(2)}s`,
      `- 认知锚点：${scene.key_information}`,
      `- 核心画面：${scene.description}`,
      `- 构图：${scene.visual_setup}`,
      `- 画面文字：${scene.text_overlay || "无"}`,
      "",
      "## 旁白",
      "",
      scene.narration,
      "",
      "## 绘制节拍",
      "",
      ...(scene.beats || []).map((beat) => `- Beat ${beat.beat_number}｜字幕 ${beat.start_caption}–${beat.end_caption}｜${(beat.start_ms / 1000).toFixed(2)}s–${(beat.end_ms / 1000).toFixed(2)}s｜${beat.expression}｜新增：${beat.visual_addition}｜焦点：${beat.focal_element}`),
    ].join("\n"));
  }
}

async function main() {
  const opt = args();
  const work = resolve(opt.workdir);
  const script = join(work, "视频.md");
  const titleFile = join(work, "标题.md");
  if (!existsSync(script)) throw new Error(`缺少 ${script}`);
  for (const bin of ["ffmpeg", "ffprobe", "python3"]) if (!Bun.which(bin)) throw new Error(`缺少运行依赖: ${bin}`);
  const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(skill, "..");
  const py = join(skill, "scripts/python/whiteboard.py");
  await loadEnv();
  const noProxyHosts = ["localhost", "127.0.0.1", "::1"];
  const existingNoProxy = `${process.env.NO_PROXY || process.env.no_proxy || ""}`.split(",").map((item) => item.trim()).filter(Boolean);
  const mergedNoProxy = Array.from(new Set([...existingNoProxy, ...noProxyHosts])).join(",");
  process.env.NO_PROXY = mergedNoProxy;
  process.env.no_proxy = mergedNoProxy;
  const cfg = await loadConfig();
  const configuredSamUrl = process.env.QIUSHUIAI_VIDEO_PIPELINE_WHITEBOARD_SAM_API_URL || process.env.SAM_API_URL || cfg.sam_api_url || DEFAULT_SAM_API_URL;
  const samUrl = await isSamHealthy(configuredSamUrl) ? configuredSamUrl : "";
  if (samUrl) console.log(`SAM3 endpoint is healthy: ${samUrl}`);
  else console.warn(`SAM3 endpoint is not healthy, skip segmentation: ${configuredSamUrl}/health`);
  const backgroundImage = cfg.background_image ? resolve(work, cfg.background_image) : "";
  if (backgroundImage && !existsSync(backgroundImage)) throw new Error(`背景图不存在: ${backgroundImage}`);
  const audio = join(work, "配音.mp3");
  const ttsSubtitle = join(work, "配音.srt");
  const ttsWords = join(work, "配音.json");
  const subtitles = join(work, "字幕.srt");
  const words = join(work, "字幕.words.json");
  const logDir = join(work, "日志");
  const subtitleLogDir = join(logDir, "字幕");
  const pipelineLogDir = join(logDir, "流水线");
  const ttsTrace = await readTtsTrace(work, opt.ttsProvider);
  const samTraceBase = {
    configured_url: configuredSamUrl,
    effective_url: samUrl || null,
    health_ok: Boolean(samUrl),
    no_proxy: process.env.NO_PROXY || null,
  };
  const trueBase = join(subtitleLogDir, "字幕-真转写");
  const trueSrt = `${trueBase}.srt`;
  const review = join(subtitleLogDir, "字幕审核.md");
  const planPath = join(work, "scene", "分镜计划.json");
  await ensureDir(subtitleLogDir);
  await ensureDir(pipelineLogDir);
  await writeFile(join(pipelineLogDir, "tts-trace.json"), JSON.stringify(ttsTrace, null, 2));
  await writeFile(join(pipelineLogDir, "sam3-trace.json"), JSON.stringify({ ...samTraceBase, scenes: [] }, null, 2));
  if (existsSync(titleFile)) console.log(`复用已存在的标题产物: ${titleFile}`);
  else console.warn(`未找到 标题.md；将从 视频.md 自动提取封面标题。开源版本不内置标题/标签生成，请由宿主或用户按需准备 标题.md。`);
  if (opt.force || !existsSync(audio) || !existsSync(subtitles) || !existsSync(words)) {
    await spawn([
      process.execPath,
      join(root, "qiushuiai-tts/scripts/main.ts"),
      "--file", script,
      "--output", join(work, "配音"),
      "--subtitle-srt-output", subtitles,
      "--subtitle-json-output", words,
      "--subtitle-format", "both",
      "--trace-output", join(pipelineLogDir, "fish-tts-chunks.json"),
      "--drop-headings",
      ...(opt.ttsProvider ? ["--provider", opt.ttsProvider] : []),
    ]);
  }
  if (!existsSync(subtitles) || !existsSync(words)) {
    if (existsSync(ttsSubtitle) && existsSync(ttsWords)) {
      await cp(ttsSubtitle, subtitles);
      await cp(ttsWords, words);
      console.log(`复用火山 TTS 原生字幕: ${ttsSubtitle} | ${ttsWords}`);
    } else {
      await spawn([process.execPath, join(root, "qiushuiai-asr/scripts/main.ts"), "--audio", audio, "--script", script, "--output", join(work, "字幕"), "--drop-headings", ...(opt.asrProvider ? ["--provider", opt.asrProvider] : [])]);
    }
  }
  if (opt.force || !existsSync(trueSrt)) await spawn([process.execPath, join(root, "qiushuiai-asr/scripts/main.ts"), "--audio", audio, "--output", trueBase, "--provider", "volcengine"]);
  const needsReview = !existsSync(review) || (await readFile(review, "utf8")).includes("字幕与视频.md存在差异");
  if (opt.force || needsReview) await reviewSubtitles(script, subtitles, trueSrt, review);
  if (opt.phase === "audio") {
    console.log(`完整音频、字幕与审核已生成: ${audio} | ${subtitles} | ${review}`);
    return;
  }
  const sourceCues = parseSrt(await readFile(subtitles, "utf8"));
  const wordsContent = await readFile(words, "utf8");
  const cues = retimeCues(sourceCues, wordsContent);
  const renderCues = segmentRenderCues(sourceCues, wordsContent, spokenScript(await readFile(script, "utf8")));
  const renderSubtitlePath = join(subtitleLogDir, "渲染字幕时间轴.srt");
  await writeFile(renderSubtitlePath, serializeSrt(renderCues));
  let plan: Plan;
  if (!opt.force && existsSync(planPath)) {
    plan = await loadPlanFromDisk(planPath);
    const planned = plan.scenes.map((scene) => scene.narration).join("").replace(/\s/g, "");
    const aligned = plan.scenes.every((scene) => {
      const first = cues[scene.start_caption - 1];
      const last = cues[scene.end_caption - 1];
      return first && last && scene.start_ms === first.startMs && scene.end_ms === last.endMs;
    });
    const imported = plan.scenes.every((scene) => existsSync(String((scene as any).asset_image || "")));
    const validScenes = plan.scenes.every((scene) => scene.start_caption && scene.end_caption && scene.start_ms >= 0 && scene.end_ms > scene.start_ms);
    const sameNarration = planned === normalizeNarration(cues.map((cue) => cue.text).join(""));
    if (!aligned || !imported || !validScenes || !sameNarration) {
      console.warn(`现有分镜计划无法安全复用，回退到 qiushui 配图导入重建: ${planPath}`);
      plan = await importQiushuiPlan(work, cues);
    }
  } else {
    plan = await importQiushuiPlan(work, cues);
  }
  const scenes: Scene[] = plan.scenes;
  if (!scenes.length) throw new Error("视频.md 中没有可用口播内容");
  await ensureDir(join(work, "scene"));
  const changedPrompts = await hydratePlanPrompts(work, plan);
  await writeSceneArtifacts(work, plan);
  const images: string[] = [];
  let imagesChanged = false;
  for (const scene of scenes) {
    const id = String(scene.index).padStart(2, "0");
    const dir = join(work, "scene", `scene-${id}`);
    const image = join(dir, "画面.png");
    await mkdir(dir, { recursive: true });
    if (opt.force || changedPrompts.has(scene.index) || !existsSync(image)) {
      const importedImage = (scene as any).asset_image as string | undefined;
      if (!importedImage || !existsSync(importedImage)) throw new Error(`缺少场景 ${scene.index} 对应的 qiushui 配图，请先生成 /配图 下的场景图片`);
      await cp(importedImage, image);
      imagesChanged = true;
    }
    images.push(image);
  }
  if (opt.approveImages) {
    console.warn("--approve-images 已弃用：当前版本的人审确认由运行时代理直接完成，脚本不再维护 review-state.json。");
  }
  if (opt.phase === "images" || opt.phase === "all") {
    const imageDir = join(work, "scene");
    console.log(`画布图片已就绪，请由运行时代理直接发送 scene/scene-*/画面.png 给用户确认: ${imageDir}\n确认后直接使用 --phase render 继续。`);
    return;
  }
  if (opt.phase === "finalize") {
    const output = join(work, "成品-有字幕.mp4");
    if (!existsSync(output)) throw new Error(`缺少成品视频，请先运行 --phase render: ${output}`);
    const { coverWide, coverTall, requestPath } = await prepareCoverRequest(work, scenes, opt.force);
    const samScenes = await readSamSceneTrace(scenes, work);
    await writeFile(join(pipelineLogDir, "sam3-trace.json"), JSON.stringify({ ...samTraceBase, scenes: samScenes }, null, 2));
    if (!existsSync(coverWide) || !existsSync(coverTall)) {
      await writeFile(join(pipelineLogDir, "pipeline-state.json"), JSON.stringify({
        status: "pending_cover_generation",
        scenes: scenes.length,
        output,
        tts: ttsTrace,
        sam3: { ...samTraceBase, scenes: samScenes },
        cover_request: requestPath,
        cover_wide: coverWide,
        cover_tall: coverTall,
        title_file: existsSync(titleFile) ? titleFile : null,
      }, null, 2));
      console.log(`缺少封面文件，请先调用 qiushuiai-video-cover:\n- 请求文件: ${requestPath}\n- 目标产物: ${coverWide} | ${coverTall}\n然后重新运行 --phase finalize。`);
      return;
    }
    const coverFirstFrame = join(work, "成品-有字幕-带封面.mp4");
    await mergeCoverIntoFirstFrame(output, coverWide, coverTall, coverFirstFrame, work);
    await writeFile(join(pipelineLogDir, "pipeline-state.json"), JSON.stringify({
      status: "complete",
      scenes: scenes.length,
      output,
      tts: ttsTrace,
      sam3: { ...samTraceBase, scenes: samScenes },
      cover_first_frame_output: coverFirstFrame,
      cover_wide: coverWide,
      cover_tall: coverTall,
      title_file: existsSync(titleFile) ? titleFile : null,
    }, null, 2));
    console.log(`首帧封面版已生成: ${coverFirstFrame}`);
    return;
  }
  const finals: string[] = [];
  const selected = opt.scene ? scenes.filter((scene) => scene.index === opt.scene) : scenes;
  if (!selected.length) throw new Error(`场景不存在: ${opt.scene}`);
  for (const scene of selected) {
    const id = String(scene.index).padStart(2, "0");
    const dir = join(work, "scene", `scene-${id}`);
    await mkdir(dir, { recursive: true });
    const text = join(dir, "旁白.txt");
    const image = join(dir, "画面.png"), sceneAudio = join(dir, "配音.mp3"), srt = join(dir, "字幕.srt");
    const segmentation = join(dir, "分层蒙版.json"), silent = join(dir, "白板动画.mp4"), final = join(dir, "场景成品.mp4"), drawMetrics = join(dir, "绘制参数.json");
    if (samUrl && (opt.force || !existsSync(segmentation))) {
      await spawn(["python3", join(skill, "scripts/python/segment.py"), "--image", image, "--output", segmentation, "--sam-url", samUrl]);
    }
    await writeFile(text, scene.narration);
    const startMs = scene.index === 1 ? 0 : scene.start_ms;
    const next = scenes.find((item) => item.index === scene.index + 1);
    const audioMs = Math.round((await duration(audio)) * 1000);
    const endMs = next ? next.start_ms : Math.min(audioMs, Math.max(scene.end_ms, cues[cues.length - 1].endMs));
    await spawn(["ffmpeg", "-y", "-i", audio, "-af", `atrim=start=${startMs / 1000}:end=${endMs / 1000},asetpts=PTS-STARTPTS`, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", sceneAudio]);
    await writeFile(srt, sceneSrt(renderCues, startMs, endMs));
    const sceneAudioDuration = await duration(sceneAudio);
    await spawn(["python3", py, "animate", "--image", image, "--output", silent, "--audio-duration", String(sceneAudioDuration), "--coverage", "0.95", "--metrics-output", drawMetrics, ...(existsSync(segmentation) ? ["--segmentation", segmentation] : [])]);
    await spawn(["python3", py, "merge", "--video", silent, "--audio", sceneAudio, ...(backgroundImage ? ["--background", backgroundImage] : []), "--output", final]);
    finals.push(final);
  }
  if (opt.scene) { console.log(`场景 ${opt.scene} 已生成: ${finals[0]}`); return; }
  const samScenes = await readSamSceneTrace(scenes, work);
  await writeFile(join(pipelineLogDir, "sam3-trace.json"), JSON.stringify({ ...samTraceBase, scenes: samScenes }, null, 2));
  const noSubtitleOutput = join(work, "成品-无字幕.mp4");
  if (finals.length === 1) await spawn(["ffmpeg", "-y", "-i", finals[0], "-c", "copy", noSubtitleOutput]);
  else await spawn(["python3", py, "concat", "--inputs", ...finals, "--output", noSubtitleOutput]);
  const output = join(work, "成品-有字幕.mp4");
  await burnFullSubtitles(noSubtitleOutput, renderSubtitlePath, output);
  const { coverWide, coverTall, requestPath } = await prepareCoverRequest(work, scenes, opt.force);
  if (opt.phase === "render") {
    await writeFile(join(pipelineLogDir, "pipeline-state.json"), JSON.stringify({
      status: "pending_cover_generation",
      scenes: scenes.length,
      output,
      tts: ttsTrace,
      sam3: { ...samTraceBase, scenes: samScenes },
      cover_request: requestPath,
      cover_wide: coverWide,
      cover_tall: coverTall,
      title_file: existsSync(titleFile) ? titleFile : null,
    }, null, 2));
    console.log(`白板视频已生成: ${output}\n请先调用 qiushuiai-video-cover 生成封面:\n- 请求文件: ${requestPath}\n- 目标产物: ${coverWide} | ${coverTall}\n完成后使用 --phase finalize 继续。`);
    return;
  }
  if (!existsSync(coverWide) || !existsSync(coverTall)) {
    await writeFile(join(pipelineLogDir, "pipeline-state.json"), JSON.stringify({
      status: "pending_cover_generation",
      scenes: scenes.length,
      output,
      tts: ttsTrace,
      sam3: { ...samTraceBase, scenes: samScenes },
      cover_request: requestPath,
      cover_wide: coverWide,
      cover_tall: coverTall,
      title_file: existsSync(titleFile) ? titleFile : null,
    }, null, 2));
    console.log(`缺少封面文件，请先调用 qiushuiai-video-cover:\n- 请求文件: ${requestPath}\n- 目标产物: ${coverWide} | ${coverTall}\n然后重新运行 --phase finalize。`);
    return;
  }
  const coverFirstFrame = join(work, "成品-有字幕-带封面.mp4");
  await mergeCoverIntoFirstFrame(output, coverWide, coverTall, coverFirstFrame, work);
  await writeFile(join(pipelineLogDir, "pipeline-state.json"), JSON.stringify({
    status: "complete",
    scenes: scenes.length,
    output,
    tts: ttsTrace,
    sam3: { ...samTraceBase, scenes: samScenes },
    cover_first_frame_output: coverFirstFrame,
    cover_wide: coverWide,
    cover_tall: coverTall,
    title_file: existsSync(titleFile) ? titleFile : null,
  }, null, 2));
  console.log(`白板视频已生成: ${output}\n封面已生成: ${coverWide} | ${coverTall}\n首帧封面版已生成: ${coverFirstFrame}`);
}

main().catch((error) => { console.error(`Error: ${error.message}`); process.exit(1); });
