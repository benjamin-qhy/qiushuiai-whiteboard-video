---
name: qiushuiai-video-pipeline-whiteboard
description: 将作品目录中预先写好的 视频.md 制作为完整的多场景白板手绘视频。默认使用 edge-tts 生成配音与字幕时间轴，按时间轴消费已确认场景图，使用 Python/OpenCV 内核逐场手绘、烧录字幕并拼接成品。适用于“做白板视频”“把文稿做成手绘动画”“运行 whiteboard pipeline”等请求。
---

# 白板视频流水线

输入作品目录内已写好的 `视频.md`，输出带配音字幕的多场景白板手绘 `成品-有字幕.mp4`。开源版本不内置标题/标签/封面生成；如需平台标题、发布标签或封面，请由用户、宿主应用或私有适配器在本流水线之外处理。

流水线会在画布图片确认关卡停住，不经确认不得制作视频。

## 用户交互工具

1. 优先使用运行时内置用户输入工具，例如 `AskUserQuestion`、`request_user_input`、`clarify` 或 `ask_user`。
2. 没有交互工具时，用编号纯文本提问。
3. 工具支持单次多问时合并相关问题；仅支持单问时按优先级逐次询问。

具体工具名只是示例，其他运行时使用本地等价工具。

## 图像生成工具

生成图像时按以下顺序选择后端：

1. 用户当前请求指定的后端。
2. 保存且当前可用的后端偏好。
3. 未指定时，如果当前运行时是 ChatGPT / Codex 且暴露了原生 `image_gen` / `imagegen`，必须直接调用原生工具逐张生成，不得因为本地存在 `qiushuiai-image-gen`、Seedream 配置或 API key 而改走脚本。
4. 只有原生工具不存在、明确不能接收本次必需参考图、无法返回/保存可用于流水线的图片，或用户明确指定外部 provider/model 时，才允许回落到 `qiushuiai-image-gen` 等非原生后端；多个非原生后端并存时询问一次。
5. 没有可用光栅后端时，告知用户并询问处理方式。

不得用 SVG、HTML、canvas 等代码渲染代替光栅图像生成。每张图片的最终完整提示词必须在调用后端前写入 `scene/scene-NN/分镜提示词.md`。本技能的本地脚本不负责在 ChatGPT / Codex 内替代原生出图；运行时代理应先用原生 `image_gen` 产出或保存场景图片，再让白板脚本从已有场景图片继续执行。`qiushuiai-image-gen` 只作为非原生运行时或明确回落条件下的兜底。

## 运行

先检测 Bun：

```bash
if command -v bun &>/dev/null; then BUN_X="bun"
elif command -v npx &>/dev/null; then BUN_X="npx -y bun"
else echo "错误：请安装 bun"; exit 1; fi
```

执行音频、字幕和场景图准备阶段：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase images
```

运行时把 `scene/scene-*/画面.png` 发给用户确认后，继续制作视频：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render
```

也可以一口气跑到成品视频：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase all
```

可选参数：

- `--force`：重新生成所有可复用阶段。
- `--phase audio|images|render|all`：只到音频字幕、只到图片就绪并交回运行时确认、渲染成品，或一口气执行到成品；默认 `images`。
- `--approve-images`：兼容旧调用，当前版本已弃用；人审确认由运行时代理完成，脚本不再维护确认状态。
- `--scene <n>`：只生成并验证指定场景，不拼接全片。
- `--image-provider <name>`：覆盖图片 provider。
- `--tts-provider <name>`：覆盖 TTS provider；默认 `edge-tts`。
- `--asr-provider <name>`：覆盖字幕 provider；默认 `edge-tts`。

依赖 `ffmpeg`、`ffprobe`、Python 3、`opencv-python`、`numpy` 和 `edge-tts`。Python 依赖见 `scripts/python/requirements.txt`。

## 运行时与子技能调用

本技能由运行时代理和脚本型白板内核两层组成，**切勿混用**：

- **外部发布文案层**：开源仓库不携带标题/标签/封面生成 skill。若需要 `标题.md`，由用户、宿主应用或私有适配器提前生成并确认。
- **脚本型白板内核**（经 `${BUN_X}` 执行 `scripts/main.ts`）：负责配音、字幕、分镜消费和渲染。

非密钥偏好从 `<cwd>/.qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md` 读取，缺失时回退 `~/.qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md`。当前脚本层只配置 `sam_api_url`、`background_image`；其中 `background_image` 为相对作品目录或绝对路径，传入后在渲染阶段直接把 `白板动画.mp4` 的纯白底替换为该背景图，并导出无字幕的 `场景成品.mp4`；全片拼接完成后，再统一使用 `日志/字幕/渲染字幕时间轴.srt` 烧录最终 `成品-有字幕.mp4`。不配置则保持原纯白底。密钥仍只从项目级或用户级 `.env` 读取。优先级为 CLI、环境变量、`CONFIG.md`、默认值。

## 文稿分镜

推荐在 `视频.md` 中用二级标题明确场景，每个 `##` 对应一个场景：

```markdown
## 开场：问题
这里是第一场口播。

## 原理解释
这里是第二场口播。
```

`视频.md` 是不可修改的只读输入。先生成全片 `配音.mp3` 与审核后的 `字幕.srt`，再调用 `qiushuiai-ip-qiushui` 产出 `配图/配图策划.md`、`配图/*-配图提示词.md`、`配图/*-对应文案片段.md` 与作品根目录 `*-配图.png`，先把这些配图直接发给用户确认；只有在用户确认配图可用后，白板脚本才继续把这些产物映射成白板视频所需的场景计划与工程文件。场景时间必须来自字幕时间轴，不得在渲染阶段重新估算。

白板视频调用 `qiushuiai-ip-qiushui` 时默认启用编号交替人物模式：奇数图使用 qiushui 作为人物主角，并使用用户头像或 `CONFIG.md` 默认头像参考；偶数图使用一位漂亮、专业、认真工作的职场女性 / 女性知识工作者作为人物主角，默认不出现 qiushui 且不使用 qiushui 头像参考。若偶数图文案确实需要多人关系，可以加入 qiushui；只要 qiushui 出现，他必须使用头像参考身份，并作为画面中的人物主角参与核心动作，不能被画成路人、背景人或弱配角。画面的第一主角始终是概念结构、物件和信息流，人物不得变成人物海报或合影。

## 工作流

1. 校验作品目录、运行依赖和只读 `视频.md`。
2. 可选复用 `标题.md`：开源仓库不内置标题/标签生成。若宿主或用户已经准备 `标题.md`，运行时代理应先展示并确认；若没有，直接跳过。
3. TTS 一次生成全片 `配音.mp3`。默认 `edge-tts`；只有显式配置或传参时才使用 Fish Audio 或火山引擎。
4. 若 TTS 没有直接写出 `字幕.srt`/`字幕.words.json`，调用 `qiushuiai-asr` 生成照稿字幕。默认 `edge-tts` 近似打轴；只有显式配置或传参时才使用真实 ASR。字幕审核必须以 `视频.md` 为正式文本来源，自动按 `视频.md` 修正 `字幕.srt` 文本，同时保持字幕编号与时间轴不变。
5. 运行时代理先调用 `qiushuiai-ip-qiushui` 生成配图策划、提示词、对应文案片段和根目录 `*-配图.png`。
6. 运行时代理直接把 `scene/scene-*/画面.png` 或待映射配图发给用户确认；用户未确认前，不继续白板渲染。
7. 用户确认后，运行时代理生成或校正 `scene/分镜计划.json`、`scene/视觉场景大纲.md` 与 `scene/scene-NN/分镜提示词.md`；白板脚本随后读取这些产物，补齐工程文件并进入 render。
8. 程序按场景真实边界切割全片音频、平移对应字幕时间轴，不重新调用 TTS/ASR。
9. 若配置 SAM3 端点，识别主要对象并生成蒙版；未配置或健康检查失败时按整图绘制降级。
10. 使用 FFmpeg concat 顺序拼接所有无字幕场景，先输出 `成品-无字幕.mp4`，再统一用 `日志/字幕/渲染字幕时间轴.srt` 烧录最终 `成品-有字幕.mp4`。
11. 流水线记录关键生产参数：`日志/流水线/tts-trace.json` 保存当次 TTS provider、voice、`rate` 等配置来源；`日志/流水线/sam3-trace.json` 保存 SAM3 配置端点、健康检查结果和每场分层文件。`pipeline-state.json` 也应嵌入这两类摘要。

详细文件契约见 [references/pipeline-workflow.md](references/pipeline-workflow.md)。

## 边界

- `标题.md` 是可选的外部发布文案产物，不属于本开源仓库的内置生成范围。
- 默认必须在 `qiushuiai-ip-qiushui` 产出配图后再次停住；用户确认这套配图前，禁止继续补白板工程文件和生成场景视频。
- 当前版本只保留这一道确认，不再增加“进入视频渲染前”的二次确认，也不再生成独立的 `日志/画布预览.jpg` 或 `review-state.json` 作为脚本关卡。
- 全片只生成一次 TTS 和字幕；禁止逐场重新合成语音或重新 ASR。
- 根目录 `视频.md`、审核后的 `字幕.srt`、`字幕.words.json` 是渲染阶段只读输入；音频/字幕审核阶段可以按 `视频.md` 自动修正 `字幕.srt` 的文本，但不得改编号、时间轴、`字幕.words.json` 或 `视频.md`。
- 短字幕分段只影响烧录显示，不得改变 Director 使用的原字幕编号、场景边界、音频或文稿。
- 第一版最终验收必须生成完整多场景视频，不以单场景成功替代全片验收。
- 当前版本中，前置配图阶段由 `qiushuiai-ip-qiushui` 负责，分镜 Director 与视觉语义审核由运行时代理直接使用当前运行时模型执行，白板脚本只消费这些产物。
- 前置配图阶段不能把 `codex-cli`、`qiushuiai-image-gen` 或任何项目级 `default_provider` 当成 ChatGPT / Codex 内的默认路径。Codex/ChatGPT IDE 内只要原生 `image_gen` / `imagegen` 可用，就必须直接用原生工具逐张生成；非 Codex 环境、无原生图像工具、原生工具不能接收必要参考图、原生工具无法返回/保存可消费图片，或用户明确指定 OpenRouter、Seedream、Google、OpenAI 等外部 provider 时，才使用 `qiushuiai-image-gen` 的配置模型。
- SAM3 端点优先使用 `QIUSHUIAI_VIDEO_PIPELINE_WHITEBOARD_SAM_API_URL`，兼容原项目旧名 `SAM_API_URL`；未配置时默认使用 `http://localhost:8000`。渲染前必须访问 `<sam_api_url>/health` 判断服务是否启动，健康检查不通过时跳过 SAM3 分层并明确提示。
