# stale-check — 收藏保鲜检查

## 是什么

扫描星标快照，找出「已 archived」与「超 N 年未推送」的仓库，按分类给出老化分布，并列出最值得复查的项。推荐工具时避开死项目；收藏定期修剪。

## 解决什么

- 首跑即发现：1639 项收藏里 **119 项已 archived**、138 项超 5 年未推送（含 minio、react-beautiful-dnd、NeteaseCloudMusicApi 这类高星但已死的项目）。
- agent 推荐时的质量闸门：候选里出现 🪦 标记要提示 kzf。

## 怎么跑

```sh
bun stale-check.ts [--years 3] [--category <分类子串>] [--limit 20]
```

- `--years`：未推送阈值（默认 3 年）；archived 单独立项。
- 数据读 `../../data/sources/github-stars/stars.json`。

## 示例输出（真实运行，`--years 5 --limit 8`）

```sh
# 保鲜检查（库共 1639，检查范围 1639，阈值 5 年）
archived: 119 项 · 超 5 年未推送: 138 项

## 老化分布（超阈值未推送，按分类）
- 早期收藏（考古区）: 82
- 未分类: 30
- 编译器、解析器与编程语言: 5
- 安全与密码学: 3
- 前端框架与 UI 组件: 3
...

## 最值得复查的 8 项（按星数排）
- minio/minio ⭐61342 (🪦archived) — MinIO is a high-performance, S3 compatible object store, open sourced under GNU
- atlassian/react-beautiful-dnd ⭐33927 (🪦archived) — Beautiful and accessible drag and drop for lists with React
- Binaryify/NeteaseCloudMusicApi ⭐30243 (🪦archived) — 网易云音乐 Node.js API service
- ariya/phantomjs ⭐29438 (🪦archived) — Scriptable Headless Browser
- codemirror/codemirror5 ⭐27219 (🪦archived) — In-browser code editor (version 5, legacy)
- microsoft/typescript-go ⭐26162 (🪦archived) — Staging repo for development of native port of TypeScript
- vercel/pkg ⭐24328 (🪦archived) — Package your Node.js project into an executable
- Sanster/IOPaint ⭐23310 (🪦archived) — Image inpainting tool powered by SOTA AI Model. Remove any unwanted object, defe
```

## 状态

proposed（2026-10-03，等 kzf 裁决）
