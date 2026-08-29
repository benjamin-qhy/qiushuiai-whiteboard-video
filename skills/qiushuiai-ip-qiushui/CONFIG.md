---
version: 1
default_avatar_ref: ""
use_default_avatar_when_missing: false
---

# qiushuiai-ip-qiushui 默认配置

- `default_avatar_ref`：当用户没有显式提供头像时，作为 qiushui IP 的默认参考头像。开源仓库默认留空，使用者可按自己的作品目录填写绝对路径。
- `use_default_avatar_when_missing`：是否在用户未提供头像时自动启用 `default_avatar_ref`。

规则：

- 用户显式传头像：优先使用用户头像。
- 用户未传头像且开关为 `true`：使用 `default_avatar_ref`。
- 没有可用头像：退回纯文字版 qiushui IP。
