# `codex-imagegen` Wrapper Invocation

仅当 [SKILL.md](../SKILL.md) 的“图像生成工具”规则解析到 `codex-imagegen` 时才加载本文件：也就是当前运行时没有原生 `imagegen` skill，但 `PATH` 中有 `codex` CLI，且用户已经完成 `codex login`。

## 优先路径：经 `qiushuiai-image-gen` 转发

如果当前运行时可用 `qiushuiai-image-gen`，**始终优先**通过它调用，而不是直接调 wrapper。这样重试、缓存、批量与 `CONFIG.md` 偏好行为能与其他 provider 保持一致。

```bash
${BUN_X} <qiushuiai-image-gen-base>/scripts/main.ts \
  --provider codex-cli \
  --image <ABSOLUTE_output> \
  --promptfiles <ABSOLUTE_prompts/NN-cover-[slug].md> \
  --ar 9:16 \
  [--ref <ABSOLUTE_file>]...
```

`<qiushuiai-image-gen-base>` 按运行时自己的 skill 发现机制解析，例如 `Skill` 工具、插件市场或 `$HOME/.qiushuiai-skills/qiushuiai-image-gen/`。

## 回退路径：直接调 wrapper

仅当当前运行时**没有**安装 `qiushuiai-image-gen` 时使用。运行时内动态定位 wrapper，**不要**从本 skill 写死 `../../packages/...`。

1. **优先显式覆盖**：若 `$QIUSHUIAI_CODEX_IMAGEGEN_BIN` 存在且指向真实文件，用该路径。兼容过渡期旧变量名 `$BAOYU_CODEX_IMAGEGEN_BIN`。若是 `.ts`，用 `bun <path>`；若是 `.sh` 或二进制，直接执行。
2. **搜索插件根目录**：从本 skill 目录向上查找 `packages/qiushuiai-codex-imagegen/src/main.ts`。找到后即为 wrapper，用 `bun` 调。
3. **最后兜底**：若仍找不到，告诉用户当前运行时不可用 `codex-imagegen`，并询问是安装 `qiushuiai-skills` 插件、设置 `QIUSHUIAI_CODEX_IMAGEGEN_BIN` / `BAOYU_CODEX_IMAGEGEN_BIN`，还是改用别的后端。

调用形态：

```bash
bun <WRAPPER>/main.ts \
  --image <ABSOLUTE_output> \
  --prompt-file <ABSOLUTE_prompts/NN-cover-[slug].md> \
  --aspect 9:16 \
  [--ref <ABSOLUTE_file>]... \
  [--timeout <ms>] \
  [--cache-dir ~/.cache/qiushuiai-codex-imagegen] \
  [--log-file <ABSOLUTE_jsonl_log_path>]
```

若未安装 `bun`，可回退为 `npx -y bun <WRAPPER>/main.ts ...`。

## 参数说明

- **所有文件路径**：运行时通常会按 `process.cwd()` 解析相对路径，但 agent 应优先传绝对路径，避免 cwd 漂移。
- **`--timeout`**：默认 `300000`（5 分钟）。慢网或复杂提示词可提高到 `600000`。
- **`--cache-dir`**：默认关闭；重复生成相同 prompt + aspect + refs 时建议开启缓存。
- **鉴权**：wrapper 使用用户现有的 Codex 订阅，不读取也不需要 `OPENAI_API_KEY`。

## Stdout 契约

单行 JSON：

- 成功：`{"status":"ok","path":"...","bytes":N,"elapsed_seconds":N,"thread_id":"...","attempts":N,"cached":bool,...}`
- 失败：`{"status":"error","path":"...","bytes":0,"error":"...","error_kind":"..."}`。

`error_kind` 可能包括：`codex_not_installed`、`invalid_args`、`prompt_file_missing`、`spawn_failed`、`timeout`、`no_image_gen_tool_use`、`output_missing`、`invalid_png`、`agent_refused`、`lock_busy`。

遇到可重试错误（如 `timeout`、`spawn_failed`、`no_image_gen_tool_use`、`output_missing`、`invalid_png`、`agent_refused`）时，询问用户要重试，还是切回别的后端。

## 批量语义

- Codex `image_gen` 每次调用只返回 **1 张图**（`n=1`）。多图任务需逐张调用 wrapper。
- wrapper **不支持** `--sessionId`。跨图一致性只能依赖 `--ref` 参考图。
- `--size` 与 `--quality` 会被忽略；Codex 按 `--aspect` 选择像素尺寸。
