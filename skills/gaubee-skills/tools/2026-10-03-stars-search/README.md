# stars-search — 本地星标速查

## 是什么

在本地星标快照（1639 项）里做多关键词检索的 CLI。给 agent 回答「我收藏里有没有做 X 的」时提供可验证的候选，而不是凭记忆。

## 解决什么

- kzf 问工具建议时，先本地检索再回答，答案可被 `stars.json` 验证。
- 支持按分类（复用 skill 的分类规则）与语言过滤。

## 怎么跑

```sh
bun stars-search.ts <关键词...> [--category <分类子串>] [--lang <语言>] [--limit 10]
```

- 多关键词是 AND 语义（都命中才算）；打分：full_name 3 > topics 2 > 描述 1.5，平局按星数。
- 数据读 `../../data/sources/github-stars/stars.json`（skill 管道自动刷新）。

## 示例输出（真实运行）

```sh
$ bun stars-search.ts typescript orm --limit 4
# 4 hits（库共 1639 项）
- prisma/orm ⭐47689 [TypeScript] (数据与存储)
  Next-generation ORM for Node.js & TypeScript | PostgreSQL, MySQL, MariaDB, SQL Server, SQLite, MongoDB and Coc
- ritz078/transform ⭐9238 [TypeScript] (前端框架与 UI 组件)
  A polyglot web converter.
- cevek/ttypescript ⭐1534 [TypeScript] (AI/LLM 模型与应用)
  Over TypeScript tool to use custom transformers in the tsconfig.json
- toon-format/toon ⭐25452 [TypeScript] (AI/LLM 模型与应用)
  🎒 Token-Oriented Object Notation (TOON) – compact, human-readable serialization of JSON data for LLM prompts.

$ bun stars-search.ts terminal --category 终端 --limit 3
# 3 hits（库共 1639 项）
- Gottox/terminal.js ⭐604 [JavaScript] (终端与 CLI)
  Javascript terminal emulator library that aims to be xterm compliant and is supposed to work in browsers and n
- zellij-org/zellij ⭐35631 [Rust] (终端与 CLI)
  A terminal workspace with batteries included
- chalk/chalk ⭐23321 [JavaScript] (终端与 CLI)
  🖍 Terminal string styling done right
```

## 状态

proposed（2026-10-03，等 kzf 裁决）
