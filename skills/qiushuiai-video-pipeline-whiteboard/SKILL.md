---
name: qiushuiai-video-pipeline-whiteboard
description: 将作品目录中预先写好的 视频.md 制作为完整的多场景白板手绘视频。先生成短视频标题与标签，再生成并审核全片配音和字幕，按真实时间轴规划主画布与 Beat，生成全部画布图片等待确认，确认后使用 Python/OpenCV 内核逐场手绘、烧录字幕并拼接成品，最后补齐横竖封面并把匹配比例的封面压到视频第一帧。适用于“做白板视频”“把文稿做成手绘动画”“运行 whiteboard pipeline”等请求。
---

# 白板视频流水线

输入作品目录内已写好的 `视频.md`，输出带配音字幕的多场景白板手绘 `成品-有字幕.mp4`、横竖封面以及首帧封面版 `成品-有字幕-带封面.mp4`。开源版本不内置标题/标签生成；如需平台标题、封面标题或标签，请由用户或宿主提前准备 `标题.md`。流水线会在画布图片确认关卡停住，不经确认不得制作视频。

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

执行：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录>
```

若作品目录已有 `标题.md`，脚本会复用其中的封面标题；没有时从 `视频.md` 自动提取兜底标题。随后脚本会生成完整音频、字幕审核；再由运行时代理调用 `qiushuiai-ip-qiushui` 产出配图并停住，等待用户确认配图后，继续消费这些产物生成白板工程：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase images
```

在运行时把 `scene/scene-*/画面.png` 发给用户确认后，继续制作视频并准备封面请求：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase render
```

调用 `qiushuiai-video-cover` 生成 `封面-横版-16x9.png` 与 `封面-竖版-9x16.png` 后，再完成首帧封面版：

```bash
${BUN_X} skills/qiushuiai-video-pipeline-whiteboard/scripts/main.ts --workdir <作品目录> --phase finalize
```

可选参数：

- `--force`：重新生成所有阶段。
- `--phase audio|images|render|finalize|all`：只到音频字幕、只到图片就绪并交回运行时确认、渲染成品并准备封面请求、在封面就绪后完成首帧封面版，或一口气执行直到需要封面 skill 介入；默认 `images`。
- `--approve-images`：兼容旧调用，当前版本已弃用；人审确认由运行时代理完成，脚本不再维护确认状态。
- `--scene <n>`：只生成并验证指定场景，不拼接全片。
- `--image-provider <name>`：覆盖图片 provider。
- `--tts-provider <name>`：覆盖 TTS provider。
- `--asr-provider <name>`：覆盖字幕 provider。

依赖 `ffmpeg`、`ffprobe`、Python 3、`opencv-python` 和 `numpy`。Python 依赖见 `scripts/python/requirements.txt`。

## 运行时与子技能调用

本技能由运行时代理和脚本型白板内核两层组成，**切勿混用**：

- **外部标题/标签层**：开源仓库不携带标题/标签生成 skill。若需要 `标题.md`，由用户、宿主应用或私有适配器提前生成并确认。
- **脚本型白板内核**（经 `${BUN_X}` 执行 `scripts/main.ts`）：负责配音、字幕、分镜消费、渲染和封面请求材料。

也就是说：

- 通过本 skill 正常运行时，若已存在 `标题.md`，应先展示并确认其中的封面标题、发布简介和标签；若不存在，允许直接进入 `scripts/main.ts`，脚本会从 `视频.md` 提取兜底封面标题。
- 若你直接手动执行 `scripts/main.ts`，它会**复用已有 `标题.md`**，但不会在本地脚本里生成平台标题或标签。

非密钥偏好从 `<cwd>/.qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md` 读取，缺失时回退 `~/.qiushuiai-skills/qiushuiai-video-pipeline-whiteboard/CONFIG.md`。当前脚本层只配置 `sam_api_url`、`background_image`；其中 `background_image` 为相对作品目录或绝对路径，传入后在渲染阶段直接把 `白板动画.mp4` 的纯白底替换为该背景图，并导出无字幕的 `场景成品.mp4`；全片拼接完成后，再统一使用 `日志/字幕/渲染字幕时间轴.srt` 烧录最终 `成品-有字幕.mp4`。不配置则保持原纯白底。密钥仍只从项目级或用户级 `.env` 读取。优先级为 CLI、环境变量、`CONFIG.md`、默认值。

## 文稿分镜

推荐在 `视频.md` 中用二级标题明确场景，每个 `##` 对应一个场景：

```markdown
## 开场：问题
这里是第一场口播。

## 原理解释
这里是第二场口播。
```

`视频.md` 是不可修改的只读输入。先生成全片 `配音.mp3` 与审核后的 `字幕.srt`，再调用 `qiushuiai-ip-qiushui` 产出 `配图/配图策划.md`、`配图/*-配图提示词.md`、`配图/*-对应文案片段.md` 与作品根目录 `*-配图.png`，先把这些配图直接发给用户确认；只有在用户确认配图可用后，白板脚本才继续把这些产物映射成白板视频所需的场景计划与工程文件。场景时间必须严格使用字幕真实毫秒时间，不得按字数估时。

白板视频调用 `qiushuiai-ip-qiushui` 时默认启用编号交替人物模式：奇数图使用 qiushui 作为人物主角，并使用用户头像或 `CONFIG.md` 默认头像参考；偶数图使用一位漂亮、专业、认真工作的职场女性 / 女性知识工作者作为人物主角，默认不出现 qiushui 且不使用 qiushui 头像参考。若偶数图文案确实需要多人关系，可以加入 qiushui；只要 qiushui 出现，他必须使用头像参考身份，并作为画面中的人物主角参与核心动作，不能被画成路人、背景人或弱配角。画面的第一主角始终是概念结构、物件和信息流，人物不得变成人物海报或合影。

## 工作流

1. 校验作品目录、运行依赖和只读 `视频.md`。
2. 可选准备 `标题.md`：开源仓库不内置标题/标签生成。若宿主或用户已经准备 `标题.md`，运行时代理应先展示并确认；若没有，脚本从 `视频.md` 自动提取兜底封面标题。
3. 复用 HyperFrames 流水线的验证路径：TTS 一次生成全片 `配音.mp3`，并优先让 `qiushuiai-tts` 直接输出正式 `字幕.srt`/`字幕.words.json`；若正式字幕仍缺失，但已存在 TTS 原生 `配音.srt`/`配音.json`，则复用为正式字幕，不再调用 `qiushuiai-asr` 生成照稿字幕；只有 TTS 未产出可用字幕时，才调用 ASR 照稿打轴生成 `字幕.srt`/`字幕.words.json`。随后使用 VolcEngine 独立真转写并写 `日志/字幕/字幕审核.md`。字幕审核必须以 `视频.md` 为正式文本来源：若 `字幕.srt` 中出现 TTS/ASR 术语错词、同音错词或标点丢失，应自动按 `视频.md` 修正 `字幕.srt` 文本，同时保持字幕编号与原时间轴不变；独立真转写只用于发现发音和术语风险，不得替代 `视频.md` 成为字幕正文。渲染阶段不得修改 `视频.md`、审核后的 `字幕.srt` 或 `字幕.words.json`。先将审核字幕单调对齐到字级真实时间，再生成仅用于最终整片烧录的社交横屏短字幕：按完整意群切分；只要遇到 `，` `。` `？` `！` `、` 就必须断句，最终显示出来的每行字幕不得保留任何标点符号；每条起止时间必须直接取首末发音字符时间，禁止按字数平均估时。结果落地 `日志/字幕/渲染字幕时间轴.srt`。
4. 运行时代理先调用 `qiushuiai-ip-qiushui`：按当前作品正文拆出 `配图/配图策划.md`、`配图/*-配图提示词.md`、`配图/*-对应文案片段.md`，并把正式配图图片输出到作品根目录 `*-配图.png`。本阶段必须使用编号交替人物模式；奇数图和包含 qiushui 的偶数多人图出图时带 qiushui 头像参考，偶数职场女性单人图不带 qiushui 头像参考。生图后端按 `qiushuiai-ip-qiushui` 的规则选择：在 ChatGPT / Codex 且当前运行时有原生 `image_gen` / `imagegen` 时，必须逐张直接调用原生工具；不得调用 `qiushuiai-image-gen`、Seedream、OpenRouter、DashScope、codex-cli 等脚本/外部接口。只有原生工具不存在、明确不能接收本次必需参考图、无法返回/保存可用于流水线的图片，或用户明确指定外部 provider/model 时，才回落到 `qiushuiai-image-gen/scripts/main.ts`，并由其 CONFIG / env / CLI 参数决定 provider 和 model。
5. 运行时代理直接把 `scene/scene-*/画面.png` 这批配图发给用户确认；这里就是唯一的人审关口。用户未确认前，不继续白板渲染；当前脚本也不生成 `日志/画布预览.jpg` 或 `review-state.json`。
6. 只有在用户明确确认“这套配图可以继续做视频”后，运行时代理应直接使用当前运行时模型生成或校正 `scene/分镜计划.json`、`scene/视觉场景大纲.md` 与 `scene/scene-NN/分镜提示词.md`；白板脚本随后读取这些产出物，并按编号顺序映射到渲染字幕时间轴，补齐 `scene/scene-NN/画面.png`、`scene/scene-NN/信息卡.json`、`scene/scene-NN/分镜.md` 等工程文件，再进入 render。
7. 当前版本不再执行图片审核、自动重生图，也不再增加“进入视频渲染前的二次确认”。
8. 程序按场景真实边界切割全片音频、平移对应字幕时间轴，不重新调用 TTS/ASR。
9. 若配置 SAM3 端点，识别主要对象并生成蒙版；未配置时按原版降级为整图绘制。绘制动画默认保持固定基础笔速；仅当原始绘制时长超过对应场景语音时长的 95% 时，才压缩到 95% 以内。若绘制提前完成，则保持完整末帧直到该场音频结束。
10. 若 `CONFIG.md` 配置了 `background_image`，则在每场最终合成 `场景成品.mp4` 时直接把 `白板动画.mp4` 的纯白底替换为该背景图，并与音频导出无字幕场景视频；未配置时继续直接从 `白板动画.mp4` 合成。
11. 使用原版 FFmpeg concat 顺序拼接所有无字幕场景，先输出 `成品-无字幕.mp4`，再统一用 `日志/字幕/渲染字幕时间轴.srt` 烧录最终 `成品-有字幕.mp4`。
12. `--phase render` 结束后，脚本会写出 `封面/cover-16x9.md`、`封面/cover-9x16.md`、`封面/cover-request.json`、`封面/封面文案.json` 与 `封面/封面生成说明.md`，作为封面调用材料。
13. 运行时代理**直接调用** `qiushuiai-video-cover`：参数语义固定为 `platform=generic`、`aspect=both`、`form=subject-led`，`text-level` 按 `标题.md` 是否有 `line2` 取 `title-subtitle` 或 `title-only`。封面阶段优先读取作品目录内的 `00-约定/封面生成约定.md`；若存在 `00-约定/头像.png`，参考图只传入它作为人物身份参考，若不存在则不强制锁定人物身份。不要把首场画面、首张配图或任何场景图作为参考图传给生图后端。封面主题只从标题、内容摘要、首场文字信息和 prompt 文本中表达，避免场景图干扰人物锁脸与封面构图。目标产物必须是 `封面-横版-16x9.png` 与 `封面-竖版-9x16.png`；其中横版核心内容收在居中的 `4:3` 内容区，竖版核心内容收在居中的 `3:4` 内容区。这里明确**不使用** `textcard` 分支。
14. 参照 HyperFrames 的最后一步，在 `qiushuiai-video-cover` 产物已落盘后运行 `--phase finalize`：读取 `成品-有字幕.mp4` 的真实像素尺寸，横版用 `封面-横版-16x9.png`、竖版用 `封面-竖版-9x16.png`，把对应封面压成第 1 帧，输出 `成品-有字幕-带封面.mp4`，并写 `日志/流水线/pipeline-state.json`。
15. 流水线必须记录关键生产参数：`日志/流水线/tts-trace.json` 保存当次可追溯的 TTS provider、voice、`rate`、火山 `speech_rate` 等配置来源；`日志/流水线/sam3-trace.json` 保存 SAM3 配置端点、实际健康检查结果、每场分层文件与标题是否第一层。`pipeline-state.json` 也应嵌入这两类摘要，便于发布后追溯。
16. 前置配图阶段必须在 `日志/视频制作日志.md` 记录图片生成追踪表。记录时间是硬要求：每张图在调用出图工具前先写下 `start_at`，工具返回后立即写 `end_at`，并计算 `duration_seconds = end_at - start_at`；失败重试也要记录 `retry_count` 和失败原因。不得只依赖生成文件 mtime 事后倒推。追踪表字段固定如下：

```markdown
| 编号 | 目标文件 | 后端 | 工具/模型 | 使用参考图 | 参考图路径 | start_at | end_at | duration_seconds | retry_count | 失败原因 | 生成源路径 | 复制到作品目录时间 |
|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|
```

使用 ChatGPT / Codex 原生 `image_gen` 时，也要由运行时代理手工记录开始、结束和耗时。时间格式使用本地时区 ISO 或 `YYYY-MM-DD HH:mm:ss`，同一作品内保持一致。使用参考图填 `是` 并写绝对路径；未使用填 `否`，参考图路径填 `无`。编号交替人物模式下，奇数图默认应记录使用 qiushui 头像参考；偶数职场女性单人图必须记录未使用 qiushui 头像参考。

详细文件契约见 [references/pipeline-workflow.md](references/pipeline-workflow.md)。当前版本要求先由 `qiushuiai-ip-qiushui` 产出 `配图/配图策划.md`、`配图/*-配图提示词.md`、`配图/*-对应文案片段.md`，并把正式配图图片输出到作品根目录 `*-配图.png|jpg|jpeg|webp`，且先经过用户确认；白板脚本不会再自行规划 prompt、调用 image-gen 或执行图片审核。运行时代理负责选择生图后端：ChatGPT / Codex 内原生 `image_gen` 是强制优先路径，`qiushuiai-image-gen` 只在无原生工具、原生工具不能满足本次必要能力、无法保存可消费图片，或用户明确指定外部 provider/model 时兜底。

## 边界

- 若 `标题.md` 由用户或宿主生成/更新，应先停住让用户确认标题、封面标题、发布简介和标签；若没有 `标题.md`，开源脚本允许用 `视频.md` 兜底继续。
- 默认必须在 `qiushuiai-ip-qiushui` 产出配图后再次停住；用户确认这套配图前，禁止继续补白板工程文件和生成场景视频。
- 当前版本只保留这一道确认，不再增加“进入视频渲染前”的二次确认，也不再生成独立的 `日志/画布预览.jpg` 或 `review-state.json` 作为脚本关卡。
- `标题.md` 是可选的发布文案产物，不属于本开源仓库的内置生成范围。若 `标题.md` 已存在但未能确认是当前任务已审核版本，仍应先展示并请求确认。
- 全片只生成一次 TTS 和字幕；禁止逐场重新合成语音或重新 ASR。
- 根目录 `视频.md`、审核后的 `字幕.srt`、`字幕.words.json` 是渲染阶段只读输入；音频/字幕审核阶段可以按 `视频.md` 自动修正 `字幕.srt` 的文本，但不得改编号、时间轴、`字幕.words.json` 或 `视频.md`。场景字幕只能由渲染时间轴平移生成。
- 短字幕分段只影响烧录显示，不得改变 Director 使用的原字幕编号、场景边界、音频或文稿；烧录分段可跨越原 SRT 条目边界，避免产生过短残句，但禁止为了凑长度增删、改写字幕文本。
- 第一版最终验收必须生成完整多场景视频，不以单场景成功替代全片验收。
- 不启用 storyboard-ai 的 Veo 和 SAM3 分支；白板单次绘制模式是默认稳定路径。
- 当前版本中，前置配图阶段由 `qiushuiai-ip-qiushui` 负责，分镜 Director 与视觉语义审核由运行时代理直接使用当前运行时模型执行，白板脚本只消费这些产物；TTS 由 `qiushuiai-tts` 执行，并优先直接写出正式 `字幕.srt` 与 `字幕.words.json`，只有正式字幕缺失且 TTS 也未产出可复用字幕时才调用 `qiushuiai-asr` 补齐。封面阶段不再由本地脚本直接落图，而是由运行时代理**直接调用** `qiushuiai-video-cover`；本地脚本负责准备 `封面/` 目录下的 `cover-request.json` / prompt / 说明材料，并在 `--phase finalize` 消费根目录 `封面-横版-16x9.png` 与 `封面-竖版-9x16.png`。
- 前置配图阶段不能把 `codex-cli`、`qiushuiai-image-gen` 或任何项目级 `default_provider` 当成 ChatGPT / Codex 内的默认路径。Codex/ChatGPT IDE 内只要原生 `image_gen` / `imagegen` 可用，就必须直接用原生工具逐张生成；非 Codex 环境、无原生图像工具、原生工具不能接收必要参考图、原生工具无法返回/保存可消费图片，或用户明确指定 OpenRouter、Seedream、Google、OpenAI 等外部 provider 时，才使用 `qiushuiai-image-gen` 的配置模型。失败时必须说明错误，不静默换模型。
- SAM3 端点优先使用 `QIUSHUIAI_VIDEO_PIPELINE_WHITEBOARD_SAM_API_URL`，兼容原项目旧名 `SAM_API_URL`；未配置时默认使用 `http://localhost:8000`。渲染前必须访问 `<sam_api_url>/health` 判断服务是否启动，健康检查不通过时跳过 SAM3 分层并明确提示。
