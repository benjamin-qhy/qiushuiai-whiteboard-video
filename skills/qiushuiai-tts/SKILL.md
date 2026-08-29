---
name: qiushuiai-tts
description: 文字转语音（TTS）— 把口播稿 / Markdown / 纯文本转成 MP3 语音，默认使用免费 edge-tts；Fish Audio 和火山引擎豆包语音 v3 可作为显式配置的商业/克隆音色 provider。默认配置统一放在 CONFIG.md。Use when the user says "生成语音"、"配音"、"文字转语音"、"口播稿转音频"、"TTS"、"text to speech"、"念出来"、"克隆声音"，或拿着一份口播脚本要进入录制替代环节时。
metadata:
  openclaw:
    homepage: https://github.com/benjamin-qhy/qiushuiai-whiteboard-video#qiushuiai-tts
    requires:
      anyBins:
        - bun
        - npx
---

# 文字转语音（TTS）

把文本（尤其是口播稿）转成 MP3 语音。默认使用免费 `edge-tts`；Fish Audio / 火山引擎豆包语音作为可选 provider，各读自己的凭证，**一处配置跨 skill 复用**。

职责单一：生成 TTS 音频。火山 v3 provider 开启原生字幕时可同时落盘字幕；Fish Audio / edge-tts 仍只产音频。剪辑不是本 skill 的事。

## 用户交互工具

本 skill 提示用户（如选音色）时，按以下优先级选择工具：

1. **优先用当前运行时内置的用户输入工具** —— 如 `AskUserQuestion`、`request_user_input`、`clarify`、`ask_user` 或等价工具。
2. **降级**：若无此类工具，输出带编号的纯文本，请用户回复编号/答案。
3. **批量**：能一次多问就合并；只能单问就逐个问。

下文对 `AskUserQuestion` 的具体提及是示例——其他运行时替换为本地等价工具。

## 图像生成工具

本 skill 不生成图像，无需图像后端。

## Script Directory

脚本在 `scripts/` 子目录。`{baseDir}` = 本 SKILL.md 所在目录。解析 `${BUN_X}` 运行时：装了 `bun` → `bun`；否则有 `npx` → `npx -y bun`；都没有则提示安装 bun。用实际值替换 `{baseDir}` 和 `${BUN_X}`。

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | 文本/Markdown → MP3；`--list-voices` 列 Fish Audio 声音 |

## Provider 与凭证

provider 抽象在 `scripts/providers/tts/`，各读下表所列的**平台级共享凭证**（同平台密钥配一次跨 skill 复用）：

| Provider | 凭证（密钥放 `.env`） | 默认声音 | 说明 |
|----------|------|------|------|
| `edge-tts`（默认） | 无需密钥（需 `pip install edge-tts`） | `zh-CN-YunxiNeural` | 免费默认 |
| `fish-audio` | `FISH_AUDIO_API_KEY`、`FISH_AUDIO_REFERENCE_ID` | reference_id 为空则用模型默认声音 | 克隆声音传 reference_id |
| `volcengine` | `VOLCENGINE_TTS_API_KEY`（v3 HTTP Chunked）；旧 v1 兼容路径才用 `VOLCENGINE_TTS_APPID`、`VOLCENGINE_TTS_TOKEN`、`VOLCENGINE_TTS_CLUSTER`、`VOLCENGINE_TTS_SPK_ID` | `zh_female_shuangkuai_moon_bigtts` | 克隆声音使用 `seed-icl-2.0` + `speaker`；普通音色使用 `seed-tts-2.0`。v3 可返回字幕，不静默回退旧接口 |

**默认 provider 选择**（无 `--provider` 且 CONFIG.md 未指定时）：`edge-tts`。若要使用 Fish Audio 或火山引擎，请显式传 `--provider` 或在 CONFIG.md 写 `provider:`。

新增 provider（如 MiniMax、阿里云 CosyVoice）：在 `providers/tts/` 加一个导出 `getDefaultVoice()` + `generateSpeech()` 的模块，在 `main.ts` 的 `loadTtsProvider` 注册，凭证按本节约定命名（`<平台>_API_KEY` 等），即可接入，不改其他 skill。

## 密钥与配置（.env + CONFIG.md）

**密钥**（API key / token）只放 `.env`，**非密钥偏好**（默认 provider / 声音 id / 语速 / cluster）放 `CONFIG.md`，两者严格分开。

**密钥 `.env`**（`main.ts` 启动时自动加载），按优先级：

```
CLI 环境变量 > process.env > <cwd>/.qiushuiai-skills/.env（项目级）> ~/.qiushuiai-skills/.env（用户级）
```

```bash
# ~/.qiushuiai-skills/.env  （用户级，全机器复用；项目级同名文件覆盖之，且务必 gitignore）
FISH_AUDIO_API_KEY=fa-xxx
VOLCENGINE_TTS_APPID=xxx
VOLCENGINE_TTS_TOKEN=xxx
VOLCENGINE_TTS_API_KEY=xxx
```

**非密钥偏好 `CONFIG.md`**，按优先级查找，第一个命中生效：

1. `<cwd>/.qiushuiai-skills/qiushuiai-tts/CONFIG.md`（项目级，优先）
2. `~/.qiushuiai-skills/qiushuiai-tts/CONFIG.md`（用户级）

```yaml
---
provider: edge-tts
voice: ""              # 通用默认声音
fish_audio:
  reference_id: ""     # 克隆声音 ID（非密钥），留空用模型默认
  speed: 1.0           # prosody 语速
mastering:
  enabled: true
  target_lufs: -16
  true_peak: -1
  lra: 7
volcengine:
  speaker: "S_xxxxxxx"       # 火山 v3 speaker / 克隆声音 ID（非密钥）
  spk_id: "S_xxxxxxx"        # 旧字段，兼容保留；新配置优先用 speaker
  voice_type: cloned         # cloned / standard
  api_resource_id: seed-icl-2.0
  model: seed-tts-2.0-standard
  enable_subtitle: true
  subtitle_format: both      # srt / json / both
  audio_format: mp3
  sample_rate: 24000
  speech_rate: 0
  loudness_rate: 0
  cluster: volcano_icl       # 旧 v1 兼容路径使用
---
```

取值优先级：**CLI 参数 > 环境变量（含 `.env`） > CONFIG.md > 硬编码默认**。

> ⚠️ **密钥绝不写进 CONFIG.md**：`api_key`/`token` 即使写进去也会被忽略（不再回填），只认 `.env`。

## 选音色（首次）

口播账号的声音应**固定**——同一人设用同一把嗓子，跨视频一致。流程：

1. 用 Fish Audio 时跑 `${BUN_X} {baseDir}/scripts/main.ts --list-voices` 列出克隆声音（`cloned_voices`）与平台声音（`platform_voices`）。
2. 用 `AskUserQuestion`（或等价工具）让用户选一个 `id`。
3. 把选定声音写入 `CONFIG.md`（如 `fish_audio.reference_id` 或 `volcengine.spk_id`），之后不用每次再问。

## Usage

```bash
# 口播稿 → 成品口播音频（默认 edge-tts，自动做响度处理）
${BUN_X} {baseDir}/scripts/main.ts --file script.md --output narration --drop-headings

# 直接文本
${BUN_X} {baseDir}/scripts/main.ts --text "你好世界" --output /tmp/hello

# 指定 provider 与克隆声音
${BUN_X} {baseDir}/scripts/main.ts --file script.md --output narration \
  --provider fish-audio --voice <reference_id> --rate "+10%"

# 火山 v3 克隆音色，同时生成音频与字幕
${BUN_X} {baseDir}/scripts/main.ts --file script.md --output narration \
  --provider volcengine --voice <speaker> --enable-subtitle --subtitle-format both

# 分别指定 SRT 与 JSON 字幕完整输出路径
${BUN_X} {baseDir}/scripts/main.ts --file script.md --output narration \
  --provider volcengine --subtitle-srt-output 字幕.srt --subtitle-json-output 字幕.words.json --subtitle-format both

# 列 Fish Audio 声音
${BUN_X} {baseDir}/scripts/main.ts --list-voices

# JSON 输出
${BUN_X} {baseDir}/scripts/main.ts --file script.md --output narration --json

# 调整成品口播响度目标
${BUN_X} {baseDir}/scripts/main.ts --file script.md --output narration \
  --target-lufs -16 --true-peak -1 --lra 7
```

`--file` 为 `.md/.mdx/.markdown` 时自动转纯文本（去 frontmatter、代码块、链接等），所以可直接喂 `script.md`。口播稿里的 `<!-- 编辑锚点 -->` 等注释也会被去掉。

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--text <text>` | 直接输入文本 | — |
| `--file <path>` | 输入 Markdown / 纯文本文件 | — |
| `--output <path>` | 输出路径（`.mp3`，无扩展名自动补） | 必填 |
| `--provider <name>` | `edge-tts` / `fish-audio` / `volcengine` | `edge-tts` |
| `--voice <name>` | voice / reference_id / spk_id | CONFIG 或 provider 默认 |
| `--rate <rate>` | 语速，如 `+20%` | `+0%` |
| `--volume <vol>` | 音量，如 `+50%` | `+0%` |
| `--pitch <pitch>` | 音高，如 `+5Hz` | `+0Hz` |
| `--target-lufs <n>` | 成品口播响度目标 | `-16` |
| `--true-peak <n>` | 成品口播 True Peak 目标 | `-1` |
| `--lra <n>` | 成品口播响度范围目标 | `7` |
| `--no-master` | 关闭默认成品口播响度处理 | false |
| `--drop-headings` | 整行删除 Markdown 标题行（口播稿结构标签不念出来） | false |
| `--list-voices` | 列 Fish Audio 声音后退出 | — |
| `--enable-subtitle` | 火山 v3 开启原生字幕输出 | CONFIG 或 true |
| `--no-subtitle` | 火山 v3 关闭原生字幕输出 | false |
| `--subtitle-output <path>` | 字幕输出路径；无扩展名自动补 `.srt/.json` | 跟随 output |
| `--subtitle-srt-output <path>` | SRT 字幕完整输出路径 | 未指定时跟随 `--subtitle-output` 或 output |
| `--subtitle-json-output <path>` | JSON 字幕完整输出路径 | 未指定时跟随 `--subtitle-output` 或 output |
| `--subtitle-format <fmt>` | `srt` / `json` / `both` | `both` |
| `--trace-output <path>` | TTS 追踪日志输出路径；Fish Audio 会记录每段文本、字数、音频字节数和生成参数 | Fish 默认 `<output>.mp3.fish-chunks.json` |

**喂口播稿 `script.md` 时务必加 `--drop-headings`**：口播稿用 `## 开场钩子 / ## 正文 / ## 结尾` 这类结构标题分段，它们是给人看的脚手架，不该被念出来。不加这个开关，默认只去 `#` 标记、保留标题文字（适合通用文章 TTS），会把「开场钩子」「正文」念进音频。
| `--json` | JSON 输出 | false |

## 在运营 vault 中使用（可选）

本 skill 不依赖 vault 也能独立用。在 qiushuiai 自媒体运营 vault 内（环境变量 `QIUSHUIAI_OPS_VAULT` 定位）按以下约定接入：

**音频落位**：口播稿在 `05-作品/草稿/口播/<id>/script.md`，则音频输出到同目录：`--output <vault>/05-作品/草稿/口播/<id>/narration`（生成 `narration.mp3`）。这样音频、脚本、之后的字幕同处一个作品目录，便于 `qiushuiai-video-cut` 取用。

vault 不存在或 `QIUSHUIAI_OPS_VAULT` 未设置时，提示用户先跑 `qiushuiai-ops-vault-init`，或直接用 `--output` 落到任意路径。

## 关键规则

1. **字幕策略**：edge-tts / Fish Audio 只产音频；火山 v3 可显式开启原生字幕。若 TTS 未生成字幕，后续流程再调用 `qiushuiai-asr` 生成字幕。
2. **音色固定**：口播账号同一人设用同一把嗓子；选定后写入 `CONFIG.md`，跨视频一致。
3. **默认导出成品口播**：生成后自动做响度处理，默认目标 `-16 LUFS / -1 dBTP / LRA 7`；需要原始 TTS 时可用 `--no-master`。
4. **凭证平台级共享**：密钥按本节统一命名放环境变量，配一次多 skill 复用；CONFIG.md 只放非密钥偏好。
5. **provider 可扩展**：加 provider 不改其他 skill，凭证照统一命名。
6. **优雅报错**：缺密钥 / edge-tts 未装 / 文本为空 / 缺 ffmpeg / 火山字幕解析失败 → 明确提示与排查指引，不静默失败。克隆音色走 v3 失败时直接报错，不回退旧接口。
7. **Fish 分段可追溯**：Fish Audio 内部会按 `fish_audio.chunk_length` 分段请求并合并音频；每次生成必须写出 chunk trace，记录每段序号、字数、原文、返回音频字节数和生成参数。默认路径为 `<output>.mp3.fish-chunks.json`；视频流水线应传 `--trace-output 日志/流水线/fish-tts-chunks.json`，方便后期定位音色、语速或拼接不稳定的具体文本段。
