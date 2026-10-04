# deps-why — “我在哪里用的 X？”依赖溯源

## 是什么

输入一个 npm 包名，回答：我有哪些项目在用它、什么版本、dev 还是运行时依赖、首次出现时间（跟踪期内真实采用日期，或如实标注“基线存量”）。

## 解决什么

- “vite 我都在哪些项目用了？”——一句命令，不用翻各仓库 package.json。
- 配合每日依赖快照，回答“我什么时候开始用 X”。
- 数据边界诚实：基线（2026-10-03 前）已存在的依赖如实标注“基线存量”，不伪装成采用事件。

## 怎么跑

```sh
bun scripts/../../tools/2026-10-04-deps-why/deps-why.ts @gaubee/nodekit
```

## 示例输出（真实运行）

```sh
$ bun tools/2026-10-04-deps-why/deps-why.ts @gaubee/nodekit
# @gaubee/nodekit — 8 个项目在使用
首次出现：早于依赖跟踪开始（2026-10-03 基线存量）

- Gaubee/grab — ^0.12.0 (devDependencies)  https://github.com/Gaubee/grab
- Gaubee/meilisearch-sdk — ^0.10.0 (devDependencies)  https://github.com/Gaubee/meilisearch-sdk
- Gaubee/f7-react — ^0.4.1 (devDependencies)  https://github.com/Gaubee/f7-react
- Gaubee/jixo — ^0.12.0 (devDependencies)  https://github.com/Gaubee/jixo
- Gaubee/import-meta-ponyfill — ^0.12.0 (devDependencies)  https://github.com/Gaubee/import-meta-ponyfill
- Gaubee/nats-server-sdk — ^0.12.0 (devDependencies)  https://github.com/Gaubee/nats-server-sdk
- Gaubee/honeymoon-book 🔒 — ^0.7.0 (devDependencies)  https://github.com/Gaubee/honeymoon-book
- Gaubee/dweb_browser-rz — ^0.4.1 (dependencies)  https://github.com/Gaubee/dweb_browser-rz
```

## 状态

proposed（2026-10-04，等 kzf 裁决）
