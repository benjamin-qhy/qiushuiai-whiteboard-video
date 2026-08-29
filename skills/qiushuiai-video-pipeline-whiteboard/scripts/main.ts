#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plan, type Scene } from "./director";
import { loadConfig } from "./config";
import { importQiushuiPlan } from "./import-qiushui-scenes";
import { parseSrt, retimeCues, reviewSubtitles, sceneSrt, segmentRenderCues, serializeSrt, spokenScript } from "./subtitles";

type Args = { workdir: string; force: boolean; approveImages: boolean; phase: "audio" | "images" | "render" | "all"; scene?: number; imageProvider?: string; ttsProvider?: string; asrProvider?: string };
const DEFAULT_SAM_API_URL = "http://localhost:8000";

function usage() {
  console.log(`Usage: qiushuiai-video-pipeline-whiteboard --workdir <作品目录> [options]

把 视频.md 制作为多场景白板手绘视频。开源版本不内置标题/标签生成。

Options:
  --workdir, --dir <path>      作品目录，至少包含 视频.md
  --phase <name>               audio | images | render | all（默认 images）
  --scene <n>                  只处理指定场景
  --force                      重新生成可复用阶段
  --image-provider <name>      传递给图像生成兜底层的 provider 名称
  --tts-provider <name>        TTS provider: edge-tts | fish-audio | volcengine（默认 edge-tts）
  --asr-provider <name>        ASR provider: edge-tts | fish-audio | volcengine（默认 edge-tts）
  --approve-images             兼容旧调用，当前版本不维护确认状态
  --help, -h                   显示帮助

Typical flow:
  bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase images
  bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render`);
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
  if (!["audio", "images", "render", "all"].includes(out.phase)) throw new Error(`未知阶段: ${out.phase}`);
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
  const ttsProvider = opt.ttsProvider || "edge-tts";
  const asrProvider = opt.asrProvider || "edge-tts";
  const ttsTrace = await readTtsTrace(work, ttsProvider);
  const samTraceBase = {
    configured_url: configuredSamUrl,
    effective_url: samUrl || null,
    health_ok: Boolean(samUrl),
    no_proxy: process.env.NO_PROXY || null,
  };
  const review = join(subtitleLogDir, "字幕审核.md");
  const planPath = join(work, "scene", "分镜计划.json");
  await ensureDir(subtitleLogDir);
  await ensureDir(pipelineLogDir);
  await writeFile(join(pipelineLogDir, "tts-trace.json"), JSON.stringify(ttsTrace, null, 2));
  await writeFile(join(pipelineLogDir, "sam3-trace.json"), JSON.stringify({ ...samTraceBase, scenes: [] }, null, 2));
  if (existsSync(titleFile)) console.log(`复用已存在的标题产物: ${titleFile}`);
  else console.warn(`未找到 标题.md；开源版本不内置标题/标签生成，请由宿主或用户按需准备。`);
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
      "--provider", ttsProvider,
    ]);
  }
  if (opt.force || !existsSync(subtitles) || !existsSync(words)) {
    if (!opt.force && existsSync(ttsSubtitle) && existsSync(ttsWords)) {
      await cp(ttsSubtitle, subtitles);
      await cp(ttsWords, words);
      console.log(`复用 TTS 原生字幕: ${ttsSubtitle} | ${ttsWords}`);
    } else {
      await spawn([process.execPath, join(root, "qiushuiai-asr/scripts/main.ts"), "--audio", audio, "--script", script, "--output", join(work, "字幕"), "--drop-headings", "--provider", asrProvider, "--max-chars", "28"]);
    }
  }
  const needsReview = !existsSync(review) || (await readFile(review, "utf8")).includes("字幕与视频.md存在差异");
  if (opt.force || needsReview) await reviewSubtitles(script, subtitles, review);
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
  if (opt.phase === "images") {
    const imageDir = join(work, "scene");
    console.log(`画布图片已就绪，请由运行时代理直接发送 scene/scene-*/画面.png 给用户确认: ${imageDir}\n确认后直接使用 --phase render 继续。`);
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
  await writeFile(join(pipelineLogDir, "pipeline-state.json"), JSON.stringify({
    status: "complete",
    scenes: scenes.length,
    output,
    tts: ttsTrace,
    sam3: { ...samTraceBase, scenes: samScenes },
    title_file: existsSync(titleFile) ? titleFile : null,
  }, null, 2));
  console.log(`白板视频已生成: ${output}`);
}

main().catch((error) => { console.error(`Error: ${error.message}`); process.exit(1); });
