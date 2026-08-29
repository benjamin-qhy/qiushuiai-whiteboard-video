# 生图提示词模板

每张图单独成图、各发明新隐喻。根据正文内容替换下面变量，不要把多张图拼在一起。本模板只产出**提示词正文**（出图由 `qiushuiai-image-gen` 用 `--promptfiles` 执行，provider/model 由出图方决定，比例按需 `--ar`）。

默认 qiushui 模式：如果本次有参考头像，把 `{REFERENCE_IDENTITY_BLOCK}` 替换为“有头像版”；如果没有参考头像，把它替换为“无头像版”。再根据该张图对应的文案片段，把 `{PRIMARY_CHARACTER_BLOCK}` 替换为“默认 qiushui 版”，把 `{SECONDARY_CHARACTERS_BLOCK}` 替换为“默认单人版”或“默认多人版”。

白板编号交替人物模式：奇数图把 `{REFERENCE_IDENTITY_BLOCK}` 替换为“有头像版”，`{PRIMARY_CHARACTER_BLOCK}` 替换为“奇数 qiushui 版”，`{SECONDARY_CHARACTERS_BLOCK}` 替换为“默认单人版”。偶数单人图把 `{REFERENCE_IDENTITY_BLOCK}` 替换为“偶数职场女性无参考版”，`{PRIMARY_CHARACTER_BLOCK}` 替换为“偶数职场女性版”，`{SECONDARY_CHARACTERS_BLOCK}` 替换为“偶数单人版”。偶数多人图把 `{REFERENCE_IDENTITY_BLOCK}` 替换为“偶数多人 qiushui 参考版”，`{PRIMARY_CHARACTER_BLOCK}` 替换为“偶数职场女性 + qiushui 版”，`{SECONDARY_CHARACTERS_BLOCK}` 替换为“偶数多人版”。不要把多个版本同时塞进同一条 prompt。

```text
Generate one standalone 16:9 horizontal Chinese article illustration.

{REFERENCE_IDENTITY_BLOCK}

Visual DNA:
Pure white background. Minimalist black hand-drawn line art. Slightly wobbly pen lines. Lots of empty white space. Sparse red/orange/blue handwritten Chinese annotations. Clean absurd product-sketch feeling. No gradients, no shadows, no paper texture, no complex background, no commercial vector style, no PPT infographic look, no cute mascot poster, no children's illustration, no realistic UI.

Primary character:
{PRIMARY_CHARACTER_BLOCK}

Secondary characters:
{SECONDARY_CHARACTERS_BLOCK}

De-emphasis (important):
Draw human characters small — height only about 1/5 to 1/4 of the canvas — and place them off to one side, never dead-center and never dominating the frame. The first thing the viewer sees must be the conceptual structure, objects and information flow (draw those the biggest and most eye-catching); human characters are active participants in one core action. Keep warm accent colors restrained on characters, and use a different, deeper, more saturated orange for flow arrows and paths so characters never compete with the functional color.

Theme:
{正文配图主题}

Structure type:
{结构类型：Workflow / 系统局部 / 前后对比 / 角色状态 / 概念隐喻 / 方法分层 / 地图路线 / 小漫画分镜}

Core idea:
{这张图要表达的核心意思}

On-image section heading:
Write this exact short handwritten Chinese section heading near the top white-space area of the canvas: "{画面标题}".
This heading must summarize the corresponding text fragment, like a section heading in an article. It should answer "这一段在讲什么？", not describe the visual metaphor or structure type.
Make it feel like a small whiteboard page heading, not a PPT title, cover title, poster slogan, or decorative label.
Use simple black handwritten text, optionally with a very light red/orange underline or small circle mark. Keep it readable but visually secondary to the main conceptual structure. Do not add any other title.

Composition:
{具体画面：主体结构/物件是什么、信息如何流动、人物在哪个角落参与什么小动作}

Suggested elements:
{元素1} / {元素2} / {元素3} / {元素4}

Chinese handwritten labels:
{标注词1} / {标注词2} / {标注词3} / {标注词4} / {可选标注词5}

Color use:
Black for main line art. Warm accent color on the character should stay restrained. A deeper, purer orange for main flow/path/arrows. Red only for key warnings/problems/results. Blue only for secondary notes or feedback/system state.

Constraints:
One image explains only one core structure. The conceptual structure should be the largest element; keep human characters small and off to one side. Preserve at least 35% blank white space. Use at most 5-8 short handwritten Chinese labels, each appearing only once. Include only the specified on-image section heading; do not add any other title. Do not write generic type titles such as "Workflow", "系统架构图", "常见坑", or "路线图". Do not write the structure type on the image. Do not make it a formal diagram, course slide, dense explainer, character poster, fashion illustration, influencer image, or group portrait. Do not copy prior examples or reuse known case compositions unless explicitly requested; invent a fresh visual metaphor for this specific article. It should be clear but not instructional, interesting but not childish, strange but clean.
```

## 有头像版 `{REFERENCE_IDENTITY_BLOCK}`

```text
Use the person in the reference image as the same identity. Do not redesign him or create a similar-looking new subject. Keep the same face identity, hairstyle, glasses, skin tone, and overall recognizability from the reference. Only adapt the body, clothing details, pose, and proportion to fit the clean hand-drawn editorial illustration style. Dress him in casual-business clothing only, and do not add any blazer, jacket, coat, or other outerwear.
```

## 偶数职场女性无参考版 `{REFERENCE_IDENTITY_BLOCK}`

```text
No external identity reference is provided for the female office-worker character. Do not use any qiushui avatar or male reference identity for this image.
```

## 偶数多人 qiushui 参考版 `{REFERENCE_IDENTITY_BLOCK}`

```text
Use the person in the reference image only for qiushui. Keep qiushui's same recognizable face identity, hairstyle, glasses, skin tone, and overall recognizability from the reference. Do not apply the reference image to the female office-worker character. The female office-worker character must be a separate person.
```

## 无头像版 `{REFERENCE_IDENTITY_BLOCK}`

```text
No external identity reference is provided. Use the built-in qiushui IP description and keep the same calm, serious, editorial office-worker feel across the image.
```

## 默认 qiushui 版 `{PRIMARY_CHARACTER_BLOCK}`

```text
qiushui, a small deadpan office-worker character, is required.
If using a reference avatar, keep the same recognizable face identity from the reference image, including the hairstyle, glasses, face structure, skin tone, and overall recognizability. Do not redesign the person or create a similar-looking new subject.
If not using a reference avatar, draw qiushui as a calm serious knowledge-worker character with dark neatly combed hair, thin round glasses, a clean illustrated face, and a restrained deadpan expression.
Adapt the body into the same simple editorial hand-drawn character language: casual-business clothing only, such as a clean shirt, polo, knit top, or light business T-shirt, with restrained colors and no outerwear of any kind. Small body, big head, slightly absurd corporate vibe, deadpan and not cute.
qiushui must perform the core conceptual action of the image, not just decorate the scene.
```

## 奇数 qiushui 版 `{PRIMARY_CHARACTER_BLOCK}`

```text
qiushui is the human lead character for this odd-numbered image. Use the reference image as qiushui's identity and keep the same recognizable face, hairstyle, glasses, face structure, skin tone, and overall recognizability. Adapt only the body, clothing details, pose, and proportion to the clean hand-drawn editorial style. qiushui must actively perform the core conceptual action, not stand aside as decoration.
```

## 偶数职场女性版 `{PRIMARY_CHARACTER_BLOCK}`

```text
A beautiful, smart, professional female office-worker / female knowledge-worker is the only human lead character for this even-numbered image. She should feel like someone seriously working in an office, at a whiteboard, in a project scene, or inside a content workflow, solving the problem represented by the image. Do not define a fixed hairstyle, face, or outfit, but keep her clean, capable, focused, and work-oriented. She must actively perform the core conceptual action. She is not an influencer, model, fashion poster subject, anime girl, decorative beauty, or sexy character. Keep her in the same minimalist black hand-drawn editorial whiteboard style, with simple casual-business clothing, restrained colors, no outerwear, and no photorealistic glamour.
Her head and facial rendering should follow an official Nobel laureate portrait illustration feeling: clean white-background logic, strong black ink outlines, warm ochre-gold painted shadow blocks, clear intelligent facial structure, calm academic presence, and restrained human warmth. Keep the person small, but make her face readable at the final image size rather than reducing it to simple dots. Apply this portrait feeling only to the head and face; the full image must remain a minimalist Chinese editorial whiteboard illustration where the conceptual structure is larger than the person. Do not make her a laureate poster, award ceremony portrait, golden fashion image, glamorous beauty portrait, or large headshot.
```

## 偶数职场女性 + qiushui 版 `{PRIMARY_CHARACTER_BLOCK}`

```text
A beautiful, smart, professional female office-worker / female knowledge-worker is one human lead character for this even-numbered image, and qiushui is also present because the text fragment needs a real multi-person relationship. Use the reference image only for qiushui and preserve qiushui's recognizable identity. The female office-worker must remain a separate person and must not inherit qiushui's face, glasses, hairstyle, skin tone, or male identity. Both human characters must actively participate in the core conceptual action; do not make qiushui a passerby, background person, weak sidekick, or decorative extra. Keep both characters small, work-oriented, and in the same minimalist hand-drawn editorial whiteboard style.
Render the female office-worker's head and face with an official Nobel laureate portrait illustration feeling: clean white-background logic, strong black ink outlines, warm ochre-gold painted shadow blocks, clear intelligent facial structure, calm academic presence, and restrained human warmth. Keep the person small, but make her face readable at the final image size rather than reducing it to simple dots. Apply this only to the female character's face and head, not to qiushui and not to the whole scene. Do not turn the image into an award poster, glamorous portrait, fashion illustration, or group portrait.
```

## 默认单人版 `{SECONDARY_CHARACTERS_BLOCK}`

```text
No additional human characters. Keep qiushui as the only person in the scene.
```

## 默认多人版 `{SECONDARY_CHARACTERS_BLOCK}`

```text
Add 1-2 supporting female characters only if needed by the scene and the corresponding text fragment. They must stay in the same minimalist hand-drawn editorial style, with simple casual-business clothing and no outerwear. They are secondary supporting figures only: they may act as collaborators, listeners, users, clients, community members, or scene participants, but must not dominate the frame, outshine qiushui, or turn the image into a character poster. If the scene includes more than three people, make every person clearly distinguishable at a glance rather than duplicated look-alikes; create separation lightly through hairstyle, face shape, body shape, facing direction, pose, placement, and a few clothing details while keeping the same minimal hand-drawn style.
```

## 偶数单人版 `{SECONDARY_CHARACTERS_BLOCK}`

```text
No additional human characters. Do not include qiushui. Do not include any male avatar, male office-worker, crowd, passerby, or background person.
```

## 偶数多人版 `{SECONDARY_CHARACTERS_BLOCK}`

```text
Only include additional people required by the text fragment's relationship scene. qiushui may appear only when the scene truly needs the relationship; if qiushui appears, he must actively participate in the core conceptual action and use the reference identity. Do not add decorative crowds or extra beauties. Keep every person small, clean, work-oriented, and visually subordinate to the conceptual structure, objects, and information flow.
```

## 图像编辑提示

去掉左上角标题：

```text
Edit the provided image. Remove only the handwritten title "{要删除的文字}" and its underline from the top-left corner. Fill that area with the same clean white background, matching the surrounding blank paper. Preserve everything else exactly: characters, labels, paths, line style, composition, aspect ratio, and image quality. Do not add any new text or objects.
```

弱化 qiushui、突出结构：

```text
Regenerate this illustration with the same core meaning and simple layout, but make the conceptual structure and objects the clear main subject and the first thing the viewer sees. Shrink qiushui to about 1/5 of the canvas height and move the character off to one side as a small participant, not the center of attention. Keep it clean, sparse, hand-drawn, and not cute.
```
