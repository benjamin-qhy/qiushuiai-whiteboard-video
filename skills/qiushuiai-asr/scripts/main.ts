#!/usr/bin/env bun
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { formatSrt } from "./srt";
import { loadDefaultConfig, loadEnv } from "./config";
import { loadDict, applyDict } from "./dict";
import type { CliArgs, SubtitleProvider, SubtitleProviderModule } from "./types";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    audio: null,
    text: null,
    dict: null,
    output: null,
    provider: null,
    voice: null,
    rate: null,
    wordsInCue: null,
    maxChars: null,
    dropHeadings: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--audio": args.audio = argv[++i]; break;
      case "--text": args.text = argv[++i]; break;
      case "--script": args.text = argv[++i]; break;
      case "--dict": args.dict = argv[++i]; break;
      case "--output": args.output = argv[++i]; break;
      case "--provider": args.provider = argv[++i] as SubtitleProvider; break;
      case "--voice": args.voice = argv[++i]; break;
      case "--rate": args.rate = argv[++i]; break;
      case "--words-in-cue": args.wordsInCue = parseInt(argv[++i], 10); break;
      case "--max-chars": args.maxChars = parseInt(argv[++i], 10); break;
      case "--drop-headings": args.dropHeadings = true; break;
      case "--json": args.json = true; break;
      case "--help":
      case "-h": args.help = true; break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: qiushuiai-asr [options]

音频 → 字幕（SRT）。默认 edge-tts 近似打轴；fish-audio / volcengine 可选真实 ASR。
配音由 qiushuiai-tts 单独生成。

Options:
  --audio <path>        输入音频（fish-audio / volcengine 真实 ASR 必填；edge-tts 可选）
  --output <path>       输出路径（.srt，无扩展名自动补）
  --provider <name>     edge-tts | fish-audio | volcengine（默认 edge-tts）
  --script <path>       口播稿文件：照稿念时作字幕基准 / ASR 失败时按时长比例兜底
  --text <text>         同 --script，但直接传文本
  --dict <path>         错词字典（逐行 "误识别 → 正确"），ASR 后逐条替换
  --voice <name>        edge-tts 重合成用的声音（默认 zh-CN-YunxiNeural）
  --words-in-cue <n>    每条字幕词数（默认 10）
  --max-chars <n>       单条字幕最大字数，超出按标点切分（默认关闭）
  --drop-headings       整行删除口播稿的 Markdown 标题行（结构标签不进字幕）
  --json                JSON 输出
  --help, -h            显示帮助

凭证环境变量：
  FISH_AUDIO_API_KEY
  VOLCENGINE_TTS_APPID / VOLCENGINE_TTS_TOKEN

默认 provider：edge-tts。若要使用 Fish Audio 或火山引擎，请通过 --provider 或 CONFIG.md 显式指定。
注：edge-tts 不做 ASR，而是按 --script/--text 重新合成估算时间轴（近似），适合无密钥兜底。`);
}

function isFishAudioAvailable(): boolean {
  return !!process.env.FISH_AUDIO_API_KEY;
}

function isVolcengineAvailable(): boolean {
  return !!(process.env.VOLCENGINE_TTS_APPID && process.env.VOLCENGINE_TTS_TOKEN);
}

function validateProvider(provider: string): asserts provider is SubtitleProvider {
  const valid = ["edge-tts", "volcengine", "fish-audio"];
  if (!valid.includes(provider)) {
    throw new Error(`Unknown subtitle provider "${provider}". Available: ${valid.join(", ")}`);
  }
  if (provider === "fish-audio" && !isFishAudioAvailable()) {
    throw new Error("fish-audio 需要 FISH_AUDIO_API_KEY 环境变量。");
  }
  if (provider === "volcengine" && !isVolcengineAvailable()) {
    throw new Error("volcengine 需要 VOLCENGINE_TTS_APPID 和 VOLCENGINE_TTS_TOKEN 环境变量。");
  }
}

async function loadSubtitleProvider(provider: SubtitleProvider): Promise<SubtitleProviderModule> {
  if (provider === "fish-audio")
    return (await import("./providers/subtitle/fish-audio")) as unknown as SubtitleProviderModule;
  if (provider === "volcengine")
    return (await import("./providers/subtitle/volcengine")) as unknown as SubtitleProviderModule;
  return (await import("./providers/subtitle/edge-tts")) as unknown as SubtitleProviderModule;
}

function stripScript(content: string, dropHeadings: boolean): string {
  let t = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = dropHeadings ? t.replace(/^#{1,6}\s+.*$/gm, "") : t.replace(/^#{1,6}\s+/gm, "");
  return t.trim();
}

async function readInputText(value: string | null, dropHeadings: boolean): Promise<string> {
  if (!value) return "";
  if (existsSync(value)) {
    const content = await readFile(resolve(value), "utf-8");
    return /\.(md|mdx|markdown)$/.test(value) ? stripScript(content, dropHeadings) : content;
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // 先加载 .env 密钥（VOLCENGINE_TTS_TOKEN / FISH_AUDIO_API_KEY 等），再读 CONFIG.md 非密钥偏好。
  await loadEnv();
  const cfg = await loadDefaultConfig();

  if (!args.output) {
    console.error("Error: --output 必填");
    process.exit(1);
  }

  const defaultProvider: SubtitleProvider = "edge-tts";
  const provider: SubtitleProvider =
    args.provider || (cfg.provider as SubtitleProvider) || defaultProvider;
  validateProvider(provider);

  const text = await readInputText(args.text, args.dropHeadings);

  if (provider === "edge-tts" && !text.trim()) {
    console.error("Error: edge-tts 需要 --script / --text（它按文本重合成估算时间轴）。");
    process.exit(1);
  }
  if (provider !== "edge-tts" && !args.audio) {
    console.error(`Error: ${provider} 需要 --audio（对音频做 ASR）。`);
    process.exit(1);
  }
  if (args.audio && !existsSync(args.audio)) {
    console.error(`Error: 音频文件不存在：${args.audio}`);
    process.exit(1);
  }

  const mod = await loadSubtitleProvider(provider);
  const voice = args.voice || cfg.voice || undefined;
  const wordsInCue = args.wordsInCue ?? cfg.words_in_cue ?? 10;
  const maxChars = args.maxChars ?? cfg.max_chars ?? 0;

  const outArg = resolve(args.output);
  const srtPath = outArg.endsWith(".srt") ? outArg : `${outArg}.srt`;
  const outputPrefix = srtPath.replace(/\.srt$/, "");

  let entries = await mod.generateSubtitles({
    text,
    voice,
    rate: args.rate || undefined,
    wordsInCue,
    maxChars,
    audioFile: args.audio ? resolve(args.audio) : undefined,
    outputPrefix,
  });

  const dictPath = args.dict || cfg.dict;
  let dictHits = 0;
  let dictRules = 0;
  if (dictPath) {
    if (!existsSync(dictPath)) {
      console.error(`警告：错词字典不存在，跳过纠错：${dictPath}`);
    } else {
      const rules = loadDict(resolve(dictPath));
      dictRules = rules.length;
      const r = applyDict(entries, rules);
      entries = r.entries;
      dictHits = r.hits;
    }
  }

  const srt = formatSrt(entries);
  await writeFile(srtPath, srt, "utf-8");
  const wordsPath = `${outputPrefix}.words.json`;
  if (!existsSync(wordsPath)) {
    await writeFile(wordsPath, JSON.stringify(entries.map((entry) => ({
      text: entry.text,
      start_time: entry.startMs,
      end_time: entry.endMs,
    })), null, 2), "utf-8");
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        status: "ok",
        provider,
        srt: srtPath,
        words: wordsPath,
        entries: entries.length,
        dictRules,
        dictHits,
      }),
    );
  } else {
    console.log(`字幕已保存: ${srtPath}（${entries.length} 条）`);
    console.log(`字幕时间 JSON 已保存: ${wordsPath}`);
    if (dictRules) console.log(`错词字典：${dictRules} 条规则，命中替换 ${dictHits} 处。`);
  }
}

try {
  await main();
} catch (err: any) {
  console.error("Error:", err.message || err);
  process.exit(1);
}
