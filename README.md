# QiushuiAI Whiteboard Video

这是一个开源的白板视频制作 skill 仓库。核心入口是 `qiushuiai-video-pipeline-whiteboard`：给作品目录准备 `视频.md`，流水线会生成配音、字幕、白板手绘场景、横竖封面请求材料，并最终产出带字幕、带首帧封面的成片。

## 包含的 skills

- `skills/qiushuiai-video-pipeline-whiteboard`：白板视频主流水线。
- `skills/qiushuiai-tts`：文本转语音，支持 Fish Audio、火山引擎和 edge-tts。
- `skills/qiushuiai-asr`：音频转字幕，支持火山引擎、Fish Audio 和 edge-tts 估算兜底。
- `skills/qiushuiai-ip-qiushui`：正文配图/白板场景图策划与提示词规则。
- `skills/qiushuiai-video-cover`：短视频横竖封面生成规则与 textcard 本地脚本。
- `skills/qiushuiai-image-gen`：非原生图像工具不可用时的 API/CLI 出图兜底。

本仓库不包含标题、标签、发布文案生成 skill。需要平台标题或标签时，请由用户、宿主应用或私有适配器提前生成 `标题.md`。

## 作品目录

最小输入：

```text
<作品目录>/
└── 视频.md
```

可选输入：

```text
<作品目录>/
├── 标题.md
└── 00-约定/
    ├── 头像.png
    └── 封面生成约定.md
```

`标题.md` 用于封面标题和发布信息。若不存在，白板脚本会从 `视频.md` 自动提取兜底封面标题。`00-约定/头像.png` 仅在需要锁定人物身份时使用；开源仓库默认不携带任何私人头像路径。

## 运行

先确认本机有 Bun、Python 3、FFmpeg：

```bash
bun --version
python3 --version
ffmpeg -version
ffprobe -version
```

从音频和配图阶段开始：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase images
```

图片确认后渲染视频：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render
```

封面生成完成后写入首帧封面：

```bash
bun skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase finalize
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

## 开发测试

```bash
bun test
npm run test:python
npm run check:whiteboard
npm run check:image-gen
npm run check:tts
npm run check:asr
```

完整端到端视频生成依赖外部 TTS、ASR、图像生成、封面生成能力和对应密钥；本仓库的默认自动化测试只覆盖可本地验证的脚本逻辑。
