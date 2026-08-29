---
name: qiushuiai-asr
description: 字幕打轴（ASR/估算）— 把一段口播音频或文稿转成 SRT 字幕，带时间轴。默认使用免费 edge-tts 按文本重合成估算；火山引擎和 Fish Audio 可作为显式配置的真实 ASR provider。支持错词字典纠错（逐条 "误识别 → 正确" 替换）与照稿念时直接用口播稿做字幕基准。只产字幕；配音由 qiushuiai-tts 生成。Use when the user says "生成字幕"、"音频转字幕"、"出字幕"、"打轴"、"ASR"、"语音转文字"、"字幕纠错"、"speech to text"、"transcribe"，或拿着一段配音要加字幕时。
version: 0.1.0
metadata:
  openclaw:
    homepage: https://github.com/benjamin-qhy/qiushuiai-whiteboard-video#qiushuiai-asr
    requires:
      anyBins:
        - bun
        - npx
---

# 音频转字幕（ASR）

把口播音频或文稿转成 SRT 字幕（带时间轴）。默认 `edge-tts` 做无密钥近似打轴；火山引擎 / Fish Audio 做可选真实 ASR。职责单一：**只产字幕**。配音是 `qiushuiai-tts`，剪辑不是本 skill 的事。

两条提准确率的路子（可叠加）：
- **照稿念** → 传口播稿 `--script`，字幕文本直接用稿子（最准）。
- **即兴 / 半即兴** → 传错词字典 `--dict`，ASR 后逐条把专名误识别替换成正确写法。

## 用户交互工具

本 skill 提示用户时，按以下优先级选择工具：

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
| `scripts/main.ts` | 音频 → SRT；可选错词字典纠错 |

部分 provider 的真实 ASR 走 `curl` 上传音频、`ffprobe` 取时长兜底——确保 `curl` 可用，`ffprobe`（FFmpeg）建议安装以启用按时长比例的兜底估算。

## Provider 与凭证

provider 抽象在 `scripts/providers/subtitle/`，各读下表所列的**平台级共享凭证**（与 `qiushuiai-tts` 同平台密钥复用同一套）：

| Provider | 凭证（密钥放 `.env`） | 机制 |
|----------|------|------|
| `edge-tts`（默认） | 无需密钥（需 `pip install edge-tts`） | **不做 ASR**，按 `--script/--text` 重合成估算时间轴（近似），无密钥默认 |
| `volcengine` | `VOLCENGINE_TTS_APPID`、`VOLCENGINE_TTS_TOKEN` | 字幕 VC 接口真实 ASR，含字级时间戳（写 `.words.json`） |
| `fish-audio` | `FISH_AUDIO_API_KEY` | ASR 接口真实识别，返回分句时间戳 |

**默认 provider 选择**（无 `--provider` 且 CONFIG.md 未指定时）：`edge-tts`。若要使用 Fish Audio 或火山引擎，请显式传 `--provider` 或在 CONFIG.md 写 `provider:`。

真实 ASR（volcengine/fish-audio）失败时，若提供了 `--script/--text` 且装了 `ffprobe`，自动回退到「按音频时长比例切句」估算，不直接报废。

新增 ASR provider（如阿里云、Whisper 本地）：在 `providers/subtitle/` 加一个导出 `generateSubtitles(options)` 的模块、在 `main.ts` 的 `loadSubtitleProvider` 注册、凭证按本节约定命名即可，不改其他 skill。

## 密钥与配置（.env + CONFIG.md）

**密钥**（API key / token）只放 `.env`，**非密钥偏好**（默认 provider / 字典路径 / 每条词数）放 `CONFIG.md`，两者严格分开。与 `qiushuiai-tts` 同平台密钥复用同一份 `.env`。

**密钥 `.env`**（`main.ts` 启动时自动加载），按优先级：

```
CLI 环境变量 > process.env > <cwd>/.qiushuiai-skills/.env（项目级）> ~/.qiushuiai-skills/.env（用户级）
```

```bash
# ~/.qiushuiai-skills/.env  （用户级，全机器复用；项目级同名文件覆盖之，且务必 gitignore）
VOLCENGINE_TTS_APPID=xxx
VOLCENGINE_TTS_TOKEN=xxx
FISH_AUDIO_API_KEY=fa-xxx
```

**非密钥偏好 `CONFIG.md`**，按优先级查找，第一个命中生效：

1. `<cwd>/.qiushuiai-skills/qiushuiai-asr/CONFIG.md`（项目级，优先）
2. `~/.qiushuiai-skills/qiushuiai-asr/CONFIG.md`（用户级）

```yaml
---
provider: edge-tts
dict: /path/to/错词字典.md   # 默认错词字典，免得每次传 --dict
words_in_cue: 10
max_chars: 0
---
```

取值优先级：**CLI 参数 > 环境变量（含 `.env`） > CONFIG.md > 硬编码默认**。

> ⚠️ **密钥绝不写进 CONFIG.md**，只认 `.env`。（CONFIG.md 过渡期仍兼容旧文件名 `default-config.md`。）

## 错词字典

即兴口播没逐字稿时，用字典纠正 ASR 易错的专名。格式逐行 `误识别 → 正确`（`->`/`=>` 亦可），`#`/`>`/表格/代码围栏行忽略——所以模板文件可直接当字典传。模板见 [references/错词字典模板.md](references/错词字典模板.md)。

一份字典复用所有视频，建议放 vault 的 `01-账号/错词字典.md`，常踩的错误持续往里加；或在 CONFIG.md 设 `dict:` 默认路径。

## Usage

```bash
# 文稿 → 字幕（默认 edge-tts 近似时间轴）
${BUN_X} {baseDir}/scripts/main.ts --script script.md --output narration --drop-headings

# 音频 → 字幕（真实 ASR 需要显式 provider）
${BUN_X} {baseDir}/scripts/main.ts --audio narration.mp3 --output narration --provider volcengine

# 照稿念：口播稿作基准 + 真实 ASR 打轴（结构标题不进字幕）
${BUN_X} {baseDir}/scripts/main.ts --audio narration.mp3 --output narration \
  --script script.md --drop-headings

# 即兴：错词字典纠错
${BUN_X} {baseDir}/scripts/main.ts --audio narration.mp3 --output narration \
  --dict 错词字典.md

# 指定 provider + 单条最多 15 字
${BUN_X} {baseDir}/scripts/main.ts --audio narration.mp3 --output narration \
  --provider volcengine --max-chars 15

# 无密钥兜底：edge-tts 按文本估算时间轴
${BUN_X} {baseDir}/scripts/main.ts --provider edge-tts --script script.md --output narration

# JSON 输出
${BUN_X} {baseDir}/scripts/main.ts --audio narration.mp3 --output narration --json
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--audio <path>` | 输入音频（真实 ASR 必填；edge-tts 可选） | — |
| `--output <path>` | 输出路径（`.srt`，无扩展名自动补） | 必填 |
| `--provider <name>` | `edge-tts` / `volcengine` / `fish-audio` | `edge-tts` |
| `--script <path>` | 口播稿文件（照稿念基准 / ASR 兜底） | — |
| `--text <text>` | 同 `--script`，直接传文本 | — |
| `--dict <path>` | 错词字典 | CONFIG `dict` |
| `--voice <name>` | edge-tts 重合成声音 | `zh-CN-YunxiNeural` |
| `--words-in-cue <n>` | 每条字幕词数 | `10` |
| `--max-chars <n>` | 单条最大字数（超出按标点切分） | 关闭 |
| `--drop-headings` | 整行删除口播稿 Markdown 标题行（结构标签不进字幕） | false |
| `--json` | JSON 输出 | false |

**`--script` 喂口播稿 `script.md` 时务必加 `--drop-headings`**：`## 开场钩子 / ## 正文 / ## 结尾` 是结构脚手架，不该进字幕。不加则只去 `#` 标记保留标题文字（通用文章场景），会把「正文」等漏进字幕。

脚本会额外写 `<output>.words.json`，供白板视频流水线做字幕重定时。真实 ASR provider 若已写入更细粒度时间戳，会优先保留 provider 产物。

## 在运营 vault 中使用（可选）

本 skill 不依赖 vault 也能独立用。在 qiushuiai 自媒体运营 vault 内（`QIUSHUIAI_OPS_VAULT` 定位）按约定接入：

- **同作品目录**：口播稿在 `05-作品/草稿/口播/<id>/script.md`、音频是同目录 `narration.mp3`，则字幕输出 `--output <vault>/05-作品/草稿/口播/<id>/narration`（生成 `narration.srt`，volcengine 另出 `narration.words.json`）。脚本、音频、字幕、字级时间戳同处一处，`qiushuiai-video-cut` 直接取用。
- **照稿念**：`--script <vault>/05-作品/草稿/口播/<id>/script.md`。
- **错词字典**：`--dict <vault>/01-账号/错词字典.md`（账号级复用）。

vault 不存在或 `QIUSHUIAI_OPS_VAULT` 未设置时，提示用户先跑 `qiushuiai-ops-vault-init`，或直接用 `--output` 落任意路径。

## 关键规则

1. **只产字幕**：不配音（用 `qiushuiai-tts`）、不剪辑、不自动接下一步。
2. **准确率优先级**：照稿念 + edge-tts 估算可免费跑通；需要真实识别时显式使用真实 ASR + 错词字典。能传口播稿就传。
3. **凭证平台级共享**：密钥按本节统一命名放环境变量，与 tts 复用同一套火山/Fish 凭证。
4. **provider 可扩展**：加 provider 不改其他 skill。
5. **优雅降级**：真实 ASR 失败 → 有稿+ffprobe 时按时长比例兜底，不静默失败；字典缺失只告警跳过。
