# x-search — X 动态速查

## 是什么

对 X (Twitter) 档案（3025 条 posted/liked/bookmarked，含正文与媒体元数据）做多关键词 AND 子串检索，带 kind/作者/媒体/时间过滤器与 `--json` 管道输出。零网络、跑完即退。

## 解决什么

- 「我记得看过/发过一条讲 X 的推」——档案刚完成正文/媒体回灌，此前没有检索手段。
- 档案质量抽查：`--nolocal` 直接列出本地化缺口条目（与 x-media-audit 的缺口口径一致，首跑 14 条互证）。
- 排序遵循数据法则（2026-10-04 裁决）：时间优先（新→旧），缺失时间置零沉底，id 兜底稳定序。

## 怎么跑

```sh
bun tools/2026-10-05-x-search/x-search.ts <关键词...>            # 多关键词 AND，大小写不敏感（命中正文+作者）
bun tools/2026-10-05-x-search/x-search.ts --kind liked --video zig
bun tools/2026-10-05-x-search/x-search.ts --nolocal              # 本地化缺口条目
bun tools/2026-10-05-x-search/x-search.ts --since 2026-09-01 --until 2026-09-30 --kind posted -n 50 --json
```

过滤器：`--kind posted|liked|bookmarked` · `--author <子串>` · `--media`（有任一媒体）· `--video` · `--nolocal`（任一媒体侧有远程无本地）· `--since/--until YYYY-MM-DD` · `-n <条数上限，默认 20>` · `--json`。
数据根遵循既有约定：`GAUBEE_SKILLS_DATA`（缺省 `~/.gaubee-skills`），读 `sources/x-likes/x.json`。命中为 0 时退出码 1（grep 惯例）。

## 示例输出（真实运行，2026-10-05）

关键词定位自己的推文：

```sh
$ bun tools/2026-10-05-x-search/x-search.ts zigpty
1/3025 条命中（关键词：zigpty）
[2026-09-09] posted · 2097674082741563526 · @gaubeebangeel
  UniPty now has an official `zigpty` backend. A tiny, cross-platform PTY engine built in Zig — designed as a mo…
```

组合过滤（收藏过的、带视频的、讲 zig 的）：

```sh
$ bun tools/2026-10-05-x-search/x-search.ts --kind liked --video zig
1/3025 条命中（关键词：zig）
[] liked · 1680750981431140353 · @malcolmstill · 视频
  …the DOOM source code, it can finally run the game! #ziglang #webassembly #hurtmeplenty https://t.co/L2kuQNBo2j…
```

本地化缺口抽查（与 x-media-audit 的「图片侧 14」互证）：

```sh
$ bun tools/2026-10-05-x-search/x-search.ts --nolocal -n 3
14/3025 条命中
[2026-09-07] posted · 2096900248857944108 · @dylayed · 图×1 · 视频 · 本地化缺口
  With celld 0.4.1, you can run headless opencode sessions with ~20 lines of code! Create a session, prompt it, …
[2025-05-30] posted · 1928491318293955043 · @deepseek_ai · 图×1 · 视频 · 本地化缺口
  🚀 DeepSeek-R1-0528 is here! 🔹 Improved benchmark performance 🔹 Enhanced front-end capabilities 🔹 Reduced h…
[2025-01-19] posted · 1880926834369741280 · @anatudor · 图×1 · 视频 · 本地化缺口
  Know the animated 🌈 border + glow effect that's all the rage? It's normally done by adding an opaque cover on…
… 其余 11 条用 -n 提高上限查看
```

（`[]` 日期表示该条目缺失 created_at，按 time=0 置零沉底。）

## 状态

proposed（2026-10-05，等 kzf 裁决）
