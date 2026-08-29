---
name: qiushuiai-video-cover
description: 生成社交媒体短视频封面与缩略图，支持竖屏 9:16、横屏 16:9，以及一次产出横竖双封面；核心内容分别收在居中的 3:4 与 4:3 安全区。既支持 AI 生成的氛围底图 + 标题叠字，也支持纯本地、零 API 的文字卡封面形式。用于视频号 / 抖音 / 小红书视频 / YouTube / Shorts 等平台的封面、thumbnail、首图。Use when the user says "视频封面"、"短视频封面"、"竖屏封面"、"横版封面"、"thumbnail"、"shorts thumbnail"、"YouTube thumbnail"、"文字封面"、"标题封面"、"title card"、"video cover"，或一条视频内容需要横屏、竖屏或双画幅封面时。
version: 0.1.0
metadata:
  openclaw:
    homepage: https://github.com/benjamin-qhy/qiushuiai-whiteboard-video#qiushuiai-video-cover
    requires:
      bins:
        - python3
---

# 短视频封面生成

为社交媒体短视频生成封面与缩略图：可出**竖屏封面**（9:16）、**横屏封面**（16:9），也可一次生成**横竖双封面**。默认形态是“一张有氛围的底图 + 一行抓人的标题叠字”，也支持**纯色背景 + 标题文字**的确定性文字卡封面。

横版公众号文章封面仍优先用 `qiushuiai-cover-image`；本 skill 专注**短视频平台封面**、**thumbnail**、**首图**，强调平台适配、可读性和点击意图。

## 用户交互工具

本 skill 提示用户时，按以下优先级选择工具：

1. **优先用当前运行时内置的用户输入工具** —— 如 `AskUserQuestion`、`request_user_input`、`clarify`、`ask_user` 或等价工具。
2. **降级**：若无此类工具，输出带编号的纯文本，请用户回复编号/答案。
3. **批量**：能一次多问就合并；只能单问就逐个问。

下文对 `AskUserQuestion` 的具体提及是示例——其他运行时替换为本地等价工具。

## 图像生成工具

需要出图时，先判断封面形式：

- 若封面形式是 `textcard`（纯色背景 + 标题文字），**不要**调用 AI 图像后端；直接运行本 skill 自带的本地脚本 `scripts/cover_textcard.py`。
- 其他形式（如氛围图、人物图、场景图、对比式封面）再按以下顺序解析图像后端：

1. **当次请求覆盖** —— 用户在当前消息里明确点名某后端 / provider / model，就优先用它；若该后端不可用、失败或不支持参考图，停止说明，不要静默换模型。
2. **Codex IDE / 当前运行时原生图像工具优先** —— 在 Codex IDE / ChatGPT 等运行时中，只要本轮可用 `image_gen` / `imagegen` 这类原生光栅图像工具，AI 封面默认必须先用它生成。每张封面单独调用，传入已保存提示词文件的完整内容、目标画幅和必要参考图；生成后保存或转存到指定交付路径。
3. **回落到 `qiushuiai-image-gen`** —— 当前运行时没有原生图像工具、原生工具不能保存到工作区、原生工具不支持当前必要参考图能力，或原生工具调用失败时，回落到 `qiushuiai-image-gen/scripts/main.ts`。
4. **回落时不写死 provider/model** —— 使用 `qiushuiai-image-gen` 时，封面 skill 只传提示词、画幅、输出路径和参考图；provider / model 交给 `qiushuiai-image-gen` 的 CLI 参数、项目 CONFIG、环境变量和用户 CONFIG 决定。
5. **都不可用**，告知用户并询问如何处理；若用户接受，也可回退到 `textcard` 形式。

`preferred_image_backend: ask` 表示即使当前已有可用后端，也要在每次运行时都先问用户选哪个。用户若要修改固定偏好，在 `## Changing Preferences` 或对应运行时的配置入口里调整。

**⛔ 绝不**用 SVG/HTML/canvas 等代码渲染替代栅格出图。若最终无法按第 3 步解析出可用的栅格后端，就落到第 4 步询问用户，**不要**静默改成 SVG、HTML/CSS 或其他代码绘图方案。

**⛔ 绝不**对已生成的 AI 封面做事后程序化叠字/涂改文字（ImageMagick/Pillow/Canvas/SVG/OCR 等）——标题叠字要**烘焙进提示词**让图像后端直接渲染；文字错了就**改提示词重生**、换低字/无字版，或让用户在不完美候选里挑一张。

例外只有 `textcard`：它本身就是**确定性本地排版**，文字不是“后期补丁”，而是该形式的原生生成方式。

具体工具名（`imagegen`、`image_generate`、`qiushuiai-image-gen`）是示例——其他运行时替换为本地等价物。**不要把 `codex exec` / `codex-cli` 当成 Codex IDE 的默认出图路径**；只有原生工具不可用且 `qiushuiai-image-gen` 配置明确选择了 codex-cli 时，才走 CLI 后端。

**提示词文件硬要求**：调用任何 AI 图像后端**之前**，把每张图的完整最终提示词写到独立文件 `prompts/NN-cover-[slug].md`。后端拿这个文件（或其内容）出图；该文件是复现记录，便于换后端不重写提示词。`textcard` 形式不需要提示词文件，但仍应把参数写入完成报告。

**人物封面参考图规则**：当封面是 `subject-led` 且项目约定要求使用人物头像锁定身份时，默认只把身份参考图传给生图后端，例如作品目录内的 `00-约定/头像.png`。不要把首场画面、首张配图、白板场景图或其他正文配图作为参考图一并传入；这些内容线索应写进 prompt 文本，而不是作为图像参考干扰锁脸和封面构图。只有用户当前明确要求使用主题参考图 / 背景参考图 / 草图时，才允许额外传入，并且必须注明它们不得覆盖身份参考。

**封面生成追踪硬要求**：调用任何 AI 图像后端**之前**，必须先记录本次封面图的 `start_at`；工具返回后立即记录 `end_at`，并计算 `duration_seconds`。这条规则同样适用于 Codex IDE / ChatGPT 原生 `image_gen` / `imagegen`，不得只依赖输出文件 mtime 事后倒推。失败重试时要记录 `retry_count` 与失败原因。`textcard` 虽不调用 AI 图像后端，也应在完成报告里记录本地脚本开始、结束和耗时。

## Script Directory

脚本在 `scripts/` 子目录。`{baseDir}` = 本 SKILL.md 所在目录。

| 脚本 | 作用 |
|------|------|
| `scripts/cover_textcard.py` | 纯色底 + 标题文字的确定性封面；支持 9:16 / 16:9 |

## 封面维度

### 平台 `platform`

- `wechat-channels`
- `douyin`
- `xiaohongshu`
- `youtube-shorts`
- `youtube`
- `generic`

### 交付画幅 `aspect`

- `9:16`：竖屏视频封面，核心内容区为居中的 `3:4`
- `16:9`：横屏 thumbnail / 横版视频封面，核心内容区为居中的 `4:3`
- `both`：一次产出 `9:16` + `16:9`

### 封面形式 `form`

- `image-title`：AI 氛围底图 + 标题叠字，默认
- `textcard`：纯色背景 + 大标题/副标题，本地确定性生成
- `scene-led`：场景氛围主导，字少
- `subject-led`：人物 / 产品主体主导
- `split-contrast`：对比式封面，适合教程、避坑、前后变化
- `quote-card`：一句话观点 / 金句型封面
- `minimal-symbolic`：极简、符号化、品牌感

### 文本密度 `text-level`

- `none`
- `title-only`
- `title-subtitle`
- `hook-heavy`

## 预设

| Preset | Form | 推荐场景 |
|--------|------|----------|
| `hook-smash` | image-title | 抖音 / 视频号，强钩子、大标题 |
| `clean-magazine` | scene-led | 小红书、品牌内容、清新审美 |
| `expert-thumbnail` | split-contrast | YouTube 教程、知识型横版封面 |
| `human-closeup` | subject-led | 人物表达、情绪驱动视频 |
| `before-after` | split-contrast | 对比、改造、案例复盘 |
| `quiet-luxury` | minimal-symbolic | 高级感、观点型、字少 |
| `title-card` | textcard | 纯色文字卡、沉稳标题封面、零 API |

## Options

| Option | Description |
|--------|-------------|
| `--platform <name>` | `wechat-channels` / `douyin` / `xiaohongshu` / `youtube-shorts` / `youtube` / `generic` |
| `--aspect <ratio>` | `9:16` / `16:9` / `both` |
| `--form <name>` | `image-title` / `textcard` / `scene-led` / `subject-led` / `split-contrast` / `quote-card` / `minimal-symbolic` |
| `--preset <name>` | 快捷预设：`hook-smash` / `clean-magazine` / `expert-thumbnail` / `human-closeup` / `before-after` / `quiet-luxury` / `title-card` |
| `--text-level <name>` | `none` / `title-only` / `title-subtitle` / `hook-heavy` |
| `--yes` | 跳过确认，按自动推荐直接出图 |
| `--ref <files...>` | 参考图；仅 AI 出图形式使用 |

## Vault 定位（可选）

本 skill 不依赖 vault 也能用。在 qiushuiai 运营 vault 内（`QIUSHUIAI_OPS_VAULT` 定位）：

- 读 `01-账号/persona.md`（视觉调性、受众、做什么/不做什么）、对应平台 `01-账号/平台/<平台>.md`（封面风格差异）。
- 标题来源：口播稿 `05-作品/草稿/口播/<id>/script.md` 的标题、用户提供的 `标题.md`，或宿主应用写入 frontmatter 的候选 `titles` / 封面标题。
- 封面默认可输出到：
  - `05-作品/草稿/口播/<id>/封面-竖版-9x16.png`
  - `05-作品/草稿/口播/<id>/封面-横版-16x9.png`
  - 单图模式下可退化为用户指定的单一路径

vault 不存在或未设置环境变量时，提示先跑 `qiushuiai-ops-vault-init`，或直接用绝对路径输出。

## 流程

### 1. 收集要素（你 + 用户）

确认这些后再出图（用 `AskUserQuestion` 或等价工具，能合并就一次问）：

- **标题文案**：封面叠字。短、狠、留悬念或给利益点。建议主标 ≤ 10 字；若 `textcard`，可加一行副标。
- **目标平台**：决定默认画幅和审美重心。
- **交付画幅**：`9:16` / `16:9` / `both`。
- **封面形式**：`image-title` / `textcard` / `scene-led` / `subject-led` / `split-contrast` / `quote-card` / `minimal-symbolic`。
- **风格基调**：从 persona 取；无 persona 时问用户（大字报冲击 / 杂志清新 / 极简 / 实拍感 等）。
- **底图氛围**：AI 图像形式才需要。与选题相关的画面意象（人物、产品、场景、隐喻），底图只承载氛围，**信息靠标题**。

无 persona 时提示可先跑 `qiushuiai-account-persona`，封面风格才稳定一致。

### 2. 确认封面策略（你 + 用户）

默认要确认，除非当前请求显式说 `--yes` / “直接生成” / “跳过确认”。

至少确认：

- `platform`
- `aspect`
- `form`
- `text-level`
- 标题 / 副标题
- backend 或 `textcard`

自动推荐规则：

- 默认一次产出 `both`（`9:16` + `16:9`）
- 若明确要求横版，默认用 `16:9`
- 若用户说“都要”，默认 `both`
- 若用户说“文字封面”“纯色封面”“标题卡”，默认 `form=textcard`

### 3. 写提示词文件或本地参数（你）

若 `form=textcard`：

- 准备参数：`line1`、`line2`、`bg`、`color1`、`color2`、`aspect`
- 直接调用 `scripts/cover_textcard.py`
- 不写 AI 提示词文件

若是其他 AI 图像形式：

把完整提示词写进 `prompts/NN-cover-[slug].md`。提示词要点：

- **画幅**：按目标输出写清 `9:16` / `16:9`
- **标题即封面**：把标题文案明确写进提示词，要求大号、加粗、高对比、手机信息流尺寸仍清晰可读
- **可读性遮罩**：标题区需要渐变遮罩 / 色块底 / 低噪背景
- **背景一致性**：整张封面必须是一个连续完整背景。安全区只用于约束构图，不得表现为可见白色矩形、内嵌卡片、截图框、人物独立白底区域或前景海报框。人物、标题和主题元素必须共享同一套背景色、纸张纹理、光影和噪声。
- **一个记忆点**：一种对比策略、一个视觉焦点，别堆元素；无 logo/tag/日期
- **安全区**：
  - `9:16`：最终画布为竖版视频比例，标题与主体必须收在垂直居中的 `3:4` 内容区内，顶部和底部只做背景延展
  - `16:9`：最终画布为横版视频比例，核心元素必须收在垂直居中的 `4:3` 内容区内，左右两侧只做背景延展
- **上游人物变体**：若请求文件或上游提示中提供 `pose_variant`、`wardrobe_variant`、`prop_variant`、`negative_pose`，必须把它们逐条写入最终提示词并优先执行；不得退回默认知识博主“单手食指向上指”的高频姿势，也不得默认沿用身份参考图中的衣服
- **风格**：按平台与 persona 落具体视觉（配色、质感、光影）

每个候选、每个画幅一个文件。要 A/B 出多版就写多个。

### 4. 出图（图像后端或本地脚本）

`textcard` 示例：

```bash
python3 {baseDir}/scripts/cover_textcard.py \
  --line1 "2个月AI替90%人工" \
  --line2 "百年保险公司真实落地" \
  --ratio 9:16 \
  --output-dir <作品目录> \
  --prefix 封面
```

AI 图像形式优先走当前运行时原生图像工具：

- 在 Codex IDE 中，先直接调用本轮可用的 `image_gen` / `imagegen`，使用 `prompts/NN-cover-[slug].md` 的完整内容作为 prompt，并带上必要参考图。
- 原生工具失败、不可用或不能落盘时，再回落到 `qiushuiai-image-gen`。

每张封面生成时必须同步写入追踪记录。优先写入作品目录 `cover-manifest.md`；若当前任务属于白板视频流水线，也要同步或摘录到 `日志/视频制作日志.md`。追踪表字段固定如下：

```markdown
| 编号 | 目标文件 | 画幅 | 封面形式 | 后端 | 工具/模型 | 使用参考图 | 参考图路径 | start_at | end_at | duration_seconds | retry_count | 失败原因 | 生成源路径 | 复制到作品目录时间 |
|---|---|---|---|---|---|---|---|---|---|---:|---:|---|---|---|
```

- 时间格式：使用本地时区 ISO 或 `YYYY-MM-DD HH:mm:ss`，同一作品内保持一致。
- `duration_seconds`：按 `end_at - start_at` 计算；不能只写“大约几分钟”。
- 使用参考图填 `是`，并写绝对路径；未使用填 `否`，参考图路径填 `无`。
- 人物封面若按项目约定必须使用作品目录内的 `00-约定/头像.png`，追踪表也必须明确记录该参考图路径；传入了参考图但锁脸失败，应在失败原因或审核记录中写明。

回落示例（以 `qiushuiai-image-gen` 为例，provider/model 由其自身配置决定）：

```bash
qiushuiai-image-gen --prompt-file prompts/01-cover-claude剪辑.md --aspect 9:16 \
  --image <vault>/05-作品/草稿/口播/<id>/封面-竖版-9x16.png
```

若 `aspect=both`，分别生成：

- `封面-竖版-9x16.png`
- `封面-横版-16x9.png`

### 5. 审核（你 + 用户）

把生成的封面给用户看。

- AI 图像形式：文字错/糊就改提示词重生或换无字版，**绝不**事后涂字
- AI 图像形式：检查背景是否连续统一。若人物或主题元素背后出现独立白色矩形、内嵌卡片、截图框、前景海报框，或人物区域与整张封面背景色、纹理、光影明显割裂，判为失败并改提示词重生
- `subject-led`：额外检查人物、标题和主题符号是否处在同一套背景光影里；安全区不能被模型画成可见容器
- `textcard`：若标题断行、字号、配色不满意，就改参数重跑脚本
- 多版时让用户挑。定稿落到作品目录

## 文件结构

推荐输出：

```text
<作品目录>/
├── prompts/
│   ├── 01-cover-9x16-[slug].md
│   ├── 02-cover-16x9-[slug].md
│   └── 03-cover-alt-[slug].md
├── 封面-竖版-9x16.png
├── 封面-横版-16x9.png
└── cover-manifest.md
```

`cover-manifest.md` 记录：

- 平台
- 画幅
- 封面形式
- 文本密度
- 标题 / 副标题
- backend 或 `textcard`
- 参考图
- 主交付图路径
- 封面生成追踪表：编号、目标文件、画幅、封面形式、后端、工具/模型、是否使用参考图、参考图路径、`start_at`、`end_at`、`duration_seconds`、`retry_count`、失败原因、生成源路径、复制到作品目录时间

## 关键规则

1. **支持横屏、竖屏、双出**：`9:16`、`16:9` 和 `both` 都是本 skill 的职责范围；`3:4` 与 `4:3` 是居中的内容安全区，不是默认交付画幅。
2. **标题叠字烘焙进提示词**：AI 图像形式不做事后程序化叠字；文字错了改提示词重生。
3. **文字卡是原生形式**：`textcard` 用本地脚本确定性生成，不属于“后期补字”。
4. **先写提示词文件**：AI 后端出图前，每张图的完整提示词先落 `prompts/`。
5. **先记时间再出图**：AI 后端和 `textcard` 本地脚本都要记录 `start_at`、`end_at`、`duration_seconds`、参考图和重试情况。
6. **标题即封面**：底图只承载氛围，信息靠大而清的标题；必须考虑可读性遮罩或低噪背景。
7. **背景必须连续统一**：人物、标题和主题元素必须处在同一套背景里；安全区不是可见卡片、白底容器、截图框或内嵌画框。
8. **背景割裂必须重生**：出图后若出现人物独立白底、前景海报框、安全区可见边框、标题区与人物区像两张图拼接，不能定稿。
9. **注入 persona + 平台风格**：跨视频封面风格一致；无 persona 引导先建。
10. **不替用户拍板**：出图前确认要素，出图后让用户审/挑。
11. **单一 skill 承担多形式封面**：不要再把文字卡拆成单独封面 skill；本 skill 统一覆盖。

## Changing Preferences

- `preferred_image_backend: auto`：默认，按“图像生成工具”自动选。
- `preferred_image_backend: ask`：每次都先问用户选哪个后端。
- `preferred_image_backend: <backend-name>`：锁定到指定后端；只有当该后端当前可用时才生效，否则回到自动选择。
