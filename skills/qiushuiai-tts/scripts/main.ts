#!/usr/bin/env bun
import { readFile, unlink, writeFile } from "fs/promises";
import { resolve } from "path";
import { markdownToPlainText } from "./markdown";
import { loadDefaultConfig, loadEnv } from "./config";
import type { CliArgs, TtsProvider, TtsProviderModule, TtsResult, TtsSubtitleWord } from "./types";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    text: null,
    file: null,
    output: null,
    provider: null,
    voice: null,
    rate: null,
    volume: null,
    pitch: null,
    targetLufs: null,
    truePeak: null,
    lra: null,
    noMaster: false,
    dropHeadings: false,
    enableSubtitle: false,
    noSubtitle: false,
    subtitleOutput: null,
    subtitleSrtOutput: null,
    subtitleJsonOutput: null,
    subtitleFormat: null,
    traceOutput: null,
    json: false,
    listVoices: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--text": args.text = argv[++i]; break;
      case "--file": args.file = argv[++i]; break;
      case "--output": args.output = argv[++i]; break;
      case "--provider": args.provider = argv[++i] as TtsProvider; break;
      case "--voice": args.voice = argv[++i]; break;
      case "--rate": args.rate = argv[++i]; break;
      case "--volume": args.volume = argv[++i]; break;
      case "--pitch": args.pitch = argv[++i]; break;
      case "--target-lufs": args.targetLufs = Number(argv[++i]); break;
      case "--true-peak": args.truePeak = Number(argv[++i]); break;
      case "--lra": args.lra = Number(argv[++i]); break;
      case "--no-master": args.noMaster = true; break;
      case "--drop-headings": args.dropHeadings = true; break;
      case "--enable-subtitle": args.enableSubtitle = true; break;
      case "--no-subtitle": args.noSubtitle = true; break;
      case "--subtitle-output": args.subtitleOutput = argv[++i]; break;
      case "--subtitle-srt-output": args.subtitleSrtOutput = argv[++i]; break;
      case "--subtitle-json-output": args.subtitleJsonOutput = argv[++i]; break;
      case "--subtitle-format": args.subtitleFormat = argv[++i] as "srt" | "json" | "both"; break;
      case "--trace-output": args.traceOutput = argv[++i]; break;
      case "--json": args.json = true; break;
      case "--list-voices": args.listVoices = true; break;
      case "--help":
      case "-h": args.help = true; break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: qiushuiai-tts [options]

口播稿 / 文本 → 语音（MP3）。火山 v3 可同时输出字幕；其他 provider 字幕由 qiushuiai-asr 生成。

Options:
  --text <text>        直接输入文本
  --file <path>        输入 Markdown / 纯文本文件（.md 自动转纯文本）
  --output <path>      输出路径（.mp3；无扩展名则补 .mp3）
  --provider <name>    TTS provider: fish-audio | volcengine | edge-tts
  --voice <name>       voice / Fish Audio reference_id / 火山 spk_id
  --rate <rate>        语速，如 +20% / -10%（默认 +0%）
  --volume <vol>       音量，如 +50%（默认 +0%）
  --pitch <pitch>      音高，如 +5Hz（默认 +0Hz）
  --target-lufs <n>    成品响度目标，如 -16（默认 -16）
  --true-peak <n>      成品 True Peak，如 -1（默认 -1）
  --lra <n>            成品响度范围，如 7（默认 7）
  --no-master          关闭默认成品口播响度处理
  --drop-headings      整行删除 Markdown 标题行（口播稿结构标签不念出来）
  --enable-subtitle    火山 v3 开启原生字幕输出
  --no-subtitle        火山 v3 关闭原生字幕输出
  --subtitle-output    字幕输出路径（无扩展名按格式补 .srt/.json）
  --subtitle-srt-output  SRT 字幕完整输出路径
  --subtitle-json-output JSON 字幕完整输出路径
  --subtitle-format    字幕格式：srt | json | both（默认 CONFIG 或 both）
  --trace-output       TTS 追踪日志输出路径（Fish 默认写 <output>.mp3.fish-chunks.json）
  --list-voices        列出 Fish Audio 可用声音（JSON）后退出
  --json               JSON 输出
  --help, -h           显示帮助

凭证环境变量：
  FISH_AUDIO_API_KEY / FISH_AUDIO_REFERENCE_ID
  VOLCENGINE_TTS_API_KEY / VOLCENGINE_TTS_APPID / VOLCENGINE_TTS_TOKEN / VOLCENGINE_TTS_CLUSTER / VOLCENGINE_TTS_SPK_ID

默认 provider：有 FISH_AUDIO_API_KEY → fish-audio；否则有 VOLCENGINE_TTS_API_KEY 或 VOLCENGINE_TTS_APPID+TOKEN → volcengine；否则 edge-tts。`);
}

function normalizeTtsResult(result: TtsResult): Exclude<TtsResult, Uint8Array> {
  if (result instanceof Uint8Array) return { audio: result };
  return result;
}

function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  const n = safe % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(n).padStart(3, "0")}`;
}

function wordsToSrt(words: TtsSubtitleWord[]): string {
  const cues: { start_ms: number; end_ms: number; text: string }[] = [];
  let current: { start_ms: number; end_ms: number; text: string } | null = null;

  for (const word of words) {
    if (!current) {
      current = { start_ms: word.start_ms, end_ms: word.end_ms, text: word.text };
      continue;
    }
    const tooLong = current.text.length >= 18;
    const largeGap = word.start_ms - current.end_ms > 350;
    if (tooLong || largeGap) {
      cues.push(current);
      current = { start_ms: word.start_ms, end_ms: word.end_ms, text: word.text };
    } else {
      current.text += word.text;
      current.end_ms = word.end_ms;
    }
  }
  if (current) cues.push(current);

  return cues.map((cue, i) => {
    return `${i + 1}\n${formatSrtTime(cue.start_ms)} --> ${formatSrtTime(cue.end_ms)}\n${cue.text}\n`;
  }).join("\n");
}

function subtitleBasePath(mp3Path: string, subtitleOutput: string | null): string {
  if (subtitleOutput) {
    const resolved = resolve(subtitleOutput);
    return resolved.replace(/\.(srt|json)$/i, "");
  }
  return mp3Path.replace(/\.mp3$/i, "");
}

async function writeSubtitles(
  mp3Path: string,
  subtitleOutput: string | null,
  subtitleSrtOutput: string | null,
  subtitleJsonOutput: string | null,
  format: "srt" | "json" | "both",
  subtitles: { raw: unknown; words?: TtsSubtitleWord[] }
): Promise<{ json?: string; srt?: string }> {
  const base = subtitleBasePath(mp3Path, subtitleOutput);
  const out: { json?: string; srt?: string } = {};
  if (format === "json" || format === "both") {
    out.json = subtitleJsonOutput ? resolve(subtitleJsonOutput) : `${base}.json`;
    await writeFile(out.json, JSON.stringify(subtitles.raw, null, 2));
  }
  if (format === "srt" || format === "both") {
    if (!subtitles.words?.length) {
      throw new Error("Volcengine returned subtitle data, but no word-level timestamps could be parsed for SRT.");
    }
    out.srt = subtitleSrtOutput ? resolve(subtitleSrtOutput) : `${base}.srt`;
    await writeFile(out.srt, wordsToSrt(subtitles.words));
  }
  return out;
}

async function runCommand(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr.trim() || `${cmd[0]} exited with code ${code}`);
}

async function masterMp3(
  inputPath: string,
  outputPath: string,
  opts: { targetLufs: number; truePeak: number; lra: number }
): Promise<void> {
  const pass1 = Bun.spawn([
    "ffmpeg",
    "-i",
    inputPath,
    "-af",
    `loudnorm=I=${opts.targetLufs}:TP=${opts.truePeak}:LRA=${opts.lra}:print_format=json`,
    "-f",
    "null",
    "-",
  ], { stdout: "ignore", stderr: "pipe" });
  const stderr1 = await new Response(pass1.stderr).text();
  const code1 = await pass1.exited;
  if (code1 !== 0) throw new Error(stderr1.trim() || "ffmpeg loudnorm pass 1 failed");
  const match = stderr1.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("Could not parse ffmpeg loudnorm stats");
  const stats = JSON.parse(match[0]) as Record<string, string>;
  const filter = [
    `loudnorm=I=${opts.targetLufs}:TP=${opts.truePeak}:LRA=${opts.lra}`,
    `measured_I=${stats.input_i}`,
    `measured_TP=${stats.input_tp}`,
    `measured_LRA=${stats.input_lra}`,
    `measured_thresh=${stats.input_thresh}`,
    `offset=${stats.target_offset}`,
    "linear=true",
  ].join(":");
  await runCommand([
    "ffmpeg",
    "-y",
    "-i",
    inputPath,
    "-af",
    filter,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

function isFishAudioAvailable(): boolean {
  return !!process.env.FISH_AUDIO_API_KEY;
}

function isVolcengineAvailable(): boolean {
  return !!(process.env.VOLCENGINE_TTS_API_KEY || (process.env.VOLCENGINE_TTS_APPID && process.env.VOLCENGINE_TTS_TOKEN));
}

function validateProvider(provider: string): asserts provider is TtsProvider {
  const valid = ["edge-tts", "volcengine", "fish-audio"];
  if (!valid.includes(provider)) {
    throw new Error(`Unknown TTS provider "${provider}". Available: ${valid.join(", ")}`);
  }
  if (provider === "fish-audio" && !isFishAudioAvailable()) {
    throw new Error("fish-audio 需要 FISH_AUDIO_API_KEY 环境变量。");
  }
  if (provider === "volcengine" && !isVolcengineAvailable()) {
    throw new Error("volcengine 需要 VOLCENGINE_TTS_API_KEY 环境变量；旧 v1 兼容路径才使用 VOLCENGINE_TTS_APPID 和 VOLCENGINE_TTS_TOKEN。");
  }
}

async function listFishAudioVoices(): Promise<void> {
  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (!apiKey) throw new Error("FISH_AUDIO_API_KEY environment variable is required");
  const headers = { Authorization: `Bearer ${apiKey}` };
  const clonedResp = await fetch("https://api.fish.audio/model?self=true&page_size=10", { headers });
  if (!clonedResp.ok) throw new Error(`Failed to fetch cloned voices: ${clonedResp.status}`);
  const clonedData = await clonedResp.json();
  const platformResp = await fetch("https://api.fish.audio/model?self=false&page_size=20&language=zh", { headers });
  if (!platformResp.ok) throw new Error(`Failed to fetch platform voices: ${platformResp.status}`);
  const platformData = await platformResp.json();
  console.log(JSON.stringify({ cloned_voices: clonedData.items ?? [], platform_voices: platformData.items ?? [] }, null, 2));
}

async function loadTtsProvider(provider: TtsProvider): Promise<TtsProviderModule> {
  if (provider === "fish-audio")
    return (await import("./providers/tts/fish-audio")) as unknown as TtsProviderModule;
  if (provider === "volcengine")
    return (await import("./providers/tts/volcengine")) as unknown as TtsProviderModule;
  return (await import("./providers/tts/edge-tts")) as unknown as TtsProviderModule;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // 先加载 .env 密钥（FISH_AUDIO_API_KEY / VOLCENGINE_TTS_TOKEN 等），再读 CONFIG.md 非密钥偏好。
  await loadEnv();
  const cfg = await loadDefaultConfig();
  // CONFIG.md 只回填非密钥偏好（声音 id / cluster）；密钥一律来自 .env / process.env。
  if (cfg.fish_audio) {
    const fa = cfg.fish_audio;
    if (!process.env.FISH_AUDIO_REFERENCE_ID && fa.reference_id) process.env.FISH_AUDIO_REFERENCE_ID = fa.reference_id;
  }
  if (cfg.volcengine) {
    const vc = cfg.volcengine;
    if (!process.env.VOLCENGINE_TTS_CLUSTER && vc.cluster) process.env.VOLCENGINE_TTS_CLUSTER = vc.cluster;
    if (!process.env.VOLCENGINE_TTS_SPK_ID && (vc.speaker || vc.spk_id)) process.env.VOLCENGINE_TTS_SPK_ID = vc.speaker || vc.spk_id;
  }

  if (args.listVoices) {
    await listFishAudioVoices();
    process.exit(0);
  }

  if (!args.text && !args.file) {
    console.error("Error: --text 或 --file 必填");
    process.exit(1);
  }
  if (!args.output) {
    console.error("Error: --output 必填");
    process.exit(1);
  }

  let text: string;
  if (args.file) {
    const filePath = resolve(args.file);
    const content = await readFile(filePath, "utf-8");
    text =
      args.file.endsWith(".md") || args.file.endsWith(".mdx") || args.file.endsWith(".markdown")
        ? markdownToPlainText(content, args.dropHeadings)
        : content;
  } else {
    text = args.text!;
  }
  if (!text.trim()) {
    console.error("Error: 输入文本为空");
    process.exit(1);
  }

  const defaultProvider: TtsProvider = isFishAudioAvailable()
    ? "fish-audio"
    : isVolcengineAvailable()
      ? "volcengine"
      : "edge-tts";
  const provider: TtsProvider = args.provider || (cfg.provider as TtsProvider) || defaultProvider;
  validateProvider(provider);

  const mod = await loadTtsProvider(provider);
  const configVoice =
    provider === "fish-audio"
      ? cfg.fish_audio?.reference_id || cfg.voice
      : provider === "volcengine"
        ? cfg.volcengine?.speaker || cfg.volcengine?.spk_id || cfg.voice
        : cfg.voice;
  const voice = args.voice || configVoice || mod.getDefaultVoice();
  const rate = args.rate || cfg.rate || "+0%";
  const volume = args.volume || "+0%";
  const pitch = args.pitch || "+0Hz";
  const masteringEnabled = args.noMaster ? false : cfg.mastering?.enabled ?? true;
  const targetLufs = args.targetLufs ?? cfg.mastering?.target_lufs ?? -16;
  const truePeak = args.truePeak ?? cfg.mastering?.true_peak ?? -1;
  const lra = args.lra ?? cfg.mastering?.lra ?? 7;

  const outArg = resolve(args.output);
  const mp3Path = outArg.endsWith(".mp3") ? outArg : `${outArg}.mp3`;
  const rawMp3Path = masteringEnabled ? `${mp3Path}.raw.mp3` : mp3Path;
  const traceOutputPath = args.traceOutput
    ? resolve(args.traceOutput)
    : provider === "fish-audio"
      ? `${mp3Path}.fish-chunks.json`
      : undefined;

  if (!args.json) {
    console.log(`TTS Provider: ${provider} (voice: ${voice || "默认"})`);
    console.log(`文本长度: ${text.length} 字`);
    console.log("生成语音中…");
  }

  const volcSubtitleEnabled =
    provider === "volcengine"
      ? args.noSubtitle
        ? false
        : (args.enableSubtitle || cfg.volcengine?.enable_subtitle) ?? true
      : false;
  const subtitleFormat = args.subtitleFormat || cfg.volcengine?.subtitle_format || "both";

  const result = normalizeTtsResult(await mod.generateSpeech(text, voice, {
    rate,
    volume,
    pitch,
    traceOutputPath,
    fishAudio:
      provider === "fish-audio"
        ? {
            speed: cfg.fish_audio?.speed,
            prosody_volume: cfg.fish_audio?.prosody_volume,
            temperature: cfg.fish_audio?.temperature,
            top_p: cfg.fish_audio?.top_p,
            repetition_penalty: cfg.fish_audio?.repetition_penalty,
            mp3_bitrate: cfg.fish_audio?.mp3_bitrate,
            latency: cfg.fish_audio?.latency,
            normalize: cfg.fish_audio?.normalize,
            chunk_length: cfg.fish_audio?.chunk_length,
          }
        : undefined,
    volcengine:
      provider === "volcengine"
        ? {
            api_resource_id: cfg.volcengine?.api_resource_id,
            voice_type: cfg.volcengine?.voice_type,
            model: cfg.volcengine?.model,
            enable_subtitle: volcSubtitleEnabled,
            audio_format: cfg.volcengine?.audio_format,
            sample_rate: cfg.volcengine?.sample_rate,
            bit_rate: cfg.volcengine?.bit_rate,
            speech_rate: cfg.volcengine?.speech_rate,
            loudness_rate: cfg.volcengine?.loudness_rate,
          }
        : undefined,
    mastering: {
      enabled: masteringEnabled,
      target_lufs: targetLufs,
      true_peak: truePeak,
      lra,
    },
  }));
  const audio = result.audio;
  await writeFile(rawMp3Path, audio);
  if (masteringEnabled) {
    if (!args.json) {
      console.log(`成品口播处理中… (LUFS ${targetLufs}, TP ${truePeak}, LRA ${lra})`);
    }
    await masterMp3(rawMp3Path, mp3Path, { targetLufs, truePeak, lra });
    await unlink(rawMp3Path).catch(() => {});
  }

  let subtitlePaths: { json?: string; srt?: string } | undefined;
  if (provider === "volcengine" && volcSubtitleEnabled) {
    if (result.subtitles) {
      subtitlePaths = await writeSubtitles(mp3Path, args.subtitleOutput, args.subtitleSrtOutput, args.subtitleJsonOutput, subtitleFormat, result.subtitles);
    } else if (!args.json) {
      console.warn("火山 TTS 未返回字幕；后续流程需要继续调用 qiushuiai-asr 生成字幕。");
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        status: "ok",
        provider,
        voice,
        mp3: mp3Path,
        subtitles: subtitlePaths || null,
        needsAsr: provider !== "volcengine" || (volcSubtitleEnabled && !subtitlePaths),
        audioSize: audio.length,
        mastering: {
          enabled: masteringEnabled,
          target_lufs: targetLufs,
          true_peak: truePeak,
          lra,
        },
        textLength: text.length,
      }),
    );
  } else {
    console.log(`音频已保存: ${mp3Path}（${audio.length} 字节）`);
    if (subtitlePaths?.json) console.log(`字幕 JSON 已保存: ${subtitlePaths.json}`);
    if (subtitlePaths?.srt) console.log(`字幕 SRT 已保存: ${subtitlePaths.srt}`);
  }
}

try {
  await main();
} catch (err: any) {
  console.error("Error:", err.message || err);
  process.exit(1);
}
