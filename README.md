# QiushuiAI Whiteboard Video

这是一个开源的白板视频制作 skill 仓库。核心入口是 `qiushuiai-video-pipeline-whiteboard`：给作品目录准备 `视频.md` 和场景配图后，流水线会生成配音、字幕、白板手绘场景，并最终产出 `成品-有字幕.mp4`。

## 包含的 skills

- `skills/qiushuiai-video-pipeline-whiteboard`：白板视频主流水线。
- `skills/qiushuiai-tts`：文本转语音，默认使用免费的 `edge-tts`，也可显式切换 Fish Audio 或火山引擎。
- `skills/qiushuiai-asr`：字幕打轴，默认使用 `edge-tts` 按文稿估算时间轴，也可显式切换 Fish Audio 或火山引擎真实 ASR。
- `skills/qiushuiai-ip-qiushui`：正文配图/白板场景图策划与提示词规则。
- `skills/qiushuiai-image-gen`：非原生图像工具不可用时的 API/CLI 出图兜底。

本仓库不包含标题、标签、发布文案或封面生成 skill。需要平台标题、标签或封面时，请由用户、宿主应用或私有适配器在流水线之外处理。

## 作品目录

最小输入：

```text
<作品目录>/
└── 视频.md
```

白板渲染还需要可消费的场景图片。通常由运行时代理先调用 `qiushuiai-ip-qiushui` 生成配图并让用户确认，再运行渲染阶段。

可选输入：

```text
<作品目录>/
├── 标题.md
└── 00-约定/
    └── 头像.png
```

`标题.md` 只作为外部发布文案产物复用；脚本不会生成标题、标签或封面。`00-约定/头像.png` 仅在需要锁定人物身份时使用；开源仓库默认不携带任何私人头像路径。

## 运行

先确认本机有 Bun、Python 3、FFmpeg 和 edge-tts：

```bash
bun --version
python3 --version
ffmpeg -version
ffprobe -version
python3 -m edge_tts --version
```

如果没有 `edge-tts`：

```bash
python3 -m pip install edge-tts
```

从音频、字幕和配图准备阶段开始：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase images
```

图片确认后渲染视频：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render
```

一口气跑到成品视频：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase all
```

默认音频和字幕都使用 `edge-tts`。如需真实 ASR 或商业 TTS，可显式指定：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render \
  --tts-provider fish-audio \
  --asr-provider volcengine
```

## 配置

密钥只放 `.env`：

```text
<cwd>/.qiushuiai-skills/.env
~/.qiushuiai-skills/.env
```

非密钥偏好放各 skill 的 `CONFIG.md`，例如：

```text
<cwd>/.qiushuiai-skills/qiushuiai-tts/CONFIG.md
<cwd>/.qiushuiai-skills/qiushuiai-asr/CONFIG.md
<cwd>/.qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md
```

默认不需要火山或 Fish 密钥。只有显式使用对应 provider 时，才需要在 `.env` 中配置对应凭证。

## 开发测试

```bash
bun test
npm run test:python
npm run check:whiteboard
npm run check:image-gen
npm run check:tts
npm run check:asr
```

完整端到端视频生成仍依赖图像生成能力和本机媒体工具；默认音频、字幕路径可用 `edge-tts` 免费跑通。
