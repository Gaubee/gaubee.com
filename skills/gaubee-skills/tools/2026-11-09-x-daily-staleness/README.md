# x-daily-staleness — 译文已入库但日报未重渲染的陈旧稿检测

## 是什么

逐份检查 `reports/daily/*-x.md`：某条推文在译文库里已经有中文译文（或 x.json 里有 xTrans），但这份日报里没有它的「译/原」切换控件——说明日报还是补译之前渲染的旧稿，需要用 `--force` 重渲染。

## 解决什么

补译一条旧推文后，`x.json` 和译文库都更新了，但已经渲染好的日报文件不会自己变。`x-daily-trans-coverage` 只管「缺译文」，管不到「有译文但没渲染」。2026-11-08/09 就靠人眼在全量扫描里发现 10-18 和 10-29 两份陈旧稿；这个工具把这件事变成一条命令。

## 怎么跑

```bash
bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts                 # 全部日报
bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts --date 2026-11-08
bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts --last 10 --strict
bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts --reports <目录>  # 夹具/演练
```

退出码：0 = 无陈旧稿（`--strict` 且有发现时 1）；2 = 参数/文件异常。纯本地只读。

判定只看两件事：该条有没有译文、日报里有没有 `xl-<id>-zh` 控件。有译文没控件就是陈旧。

## 真实示例输出（2026-11-09）

全量（刚补渲染完 10-18/10-29 之后）：

```text
2026-11-07-x.md：清新
2026-11-08-x.md：清新

合计 30 份日报，陈旧稿 0 份 / 0 条（全部已渲染）
```

用夹具演示检出能力（复制 11-08 日报并删掉一条的切换控件）：

```text
2026-11-08-x.md：1 条有译文但未渲染
  ✗ @MoeDejavu 2119059712087896452
  修法：bun scripts/x-daily-events.ts --date 2026-11-08 --run-date 2026-11-09 --force

合计 1 份日报，陈旧稿 1 份 / 1 条
```

## 建议用法

每次跑完译文增量和 `x-translations-merge.ts` 之后跑一次 `--last 5 --strict`；发现陈旧稿就按提示重渲染（`--run-date` 取报告日 + 1）。
