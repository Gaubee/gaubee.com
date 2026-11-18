# taxonomy-coverage-audit — 最近收藏里有哪些还没进策展地图

## 是什么

`taxonomy.md` 是**人工精选地图**（约 160 条），`catalog.md` 才是全量索引（1799 条）。
本工具不报「覆盖率百分比」（那会误导成工作没做完），只回答一个问题：

**最近 N 天收藏的仓库里，还有哪些没进过地图？**

## 解决什么

「未分类 438」这个数字长期挂在 taxonomy 里，但没人知道缺口里哪些是最近才收的。
按天增量补策展的话，存量缺口永远在那；反过来先补最近 30 天，才是可执行的动作。

首跑（2026-11-19）就抓到 3 条：`goeist-font`（11-16 收的，那天日报还把它错标成 gvisor）、
`OpenMausBot`、`memvid`。三条当天补进地图，缺口归零。

## 口径修正（首版写错过）

第一版打印「已策展 261/1799，覆盖率 14.5%，未策展 1538」，把人工精选当成未完成的索引，
读起来像有一千多条欠账。实际上地图本来就不追求全覆盖，全量由 catalog 承担。
修正后只报：地图有多少条、最近收藏漏了哪些。

## 怎么跑

```bash
bun tools/2026-11-19-taxonomy-coverage-audit/taxonomy-coverage-audit.ts
bun tools/2026-11-19-taxonomy-coverage-audit/taxonomy-coverage-audit.ts --since 2026-10-01 --limit 30
```

退出码：0 = 已输出；2 = 数据缺失。只读，不改 taxonomy（归哪个分类是判断活）。

## 真实示例输出（2026-11-19）

```text
策展地图：161 条条目（160 个仓库），全量索引 catalog 共 1799 条
地图是人工精选，不追求全覆盖；这里只看「最近收藏还没进地图」的部分。
2026-10-20 之后收藏的仓库里，有 3 条还没进地图

最近未策展（按收藏时间倒序，取前 3 条）：
  2026-11-16  shadcn-labs/goeist-font [Python]
           A rounded variant of Geist font ▲
  2026-10-28  milind-soni/OpenMausBot [TypeScript]
           Open-source Grok Bot alternative with a virtual machine that bots can use
  2026-10-28  memvid/memvid [Rust]
           Memory layer for AI Agents. Replace complex RAG pipelines with a serverless, single-file m
```

补完三条后重跑：`2026-10-20 之后收藏的仓库里，有 0 条还没进地图`。

## 判读建议

- 目标是「最近的别漏」，不是「全部补齐」。历史长尾留在 catalog 里照样能检索。
- 判据是「仓库全名出现在 taxonomy 任意位置」，所以写在注释里的也算提到过。
- 补完记得跑 `--build-catalog` 与 `taxonomy-count-doctor --fix`，括号计数才会对上。
