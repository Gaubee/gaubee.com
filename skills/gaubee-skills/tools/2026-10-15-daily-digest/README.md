# daily-digest — 日报写作前的跨源事实清单

## 是什么
一次读齐各源 `changes/<抓取日>.json`，输出各源计数（新增/移除/变更）与关键明细：
github-deps 的新技术首见全行、x-likes 的 kind 分布（liked/posted/…）、缺失的源如实
标注。输出头部同时标注 changes 日与报告日（T-1），避免日期误引。只读。

## 解决什么
写日报要在 4 个源目录里翻文件拼数字（星标几个、提交几条、依赖几项、X 几条哪种
行为多），每次手拼且容易漏。与 build-report（周/月/年骨架，聚合过去整周）互补：
本工具只服务「今天写昨天日报」这一件事。

口径备注：github-commits 的 changes 按报告日落盘（fetch 位置参数），其它源按抓取
日落盘——清单对 commits 会显示「changes/<抓取日>.json 缺失」，属已知命名差异，
事实以报告日那份为准。

## 怎么跑
```bash
bun tools/2026-10-15-daily-digest/daily-digest.ts [--date YYYY-MM-DD]
```
`--date` 为 changes 文件日期（缺省取所有源里最新的一份）。退出码：0 = 至少一个源
有数据；1 = 全部缺失。

## 真实示例输出（2026-10-15 实跑）
```
事实清单：changes@2026-10-15（报告日 2026-10-14，T-1）

[github-commits] changes/2026-10-15.json 缺失（当日无差分或未抓取）

[github-deps] 新增 3 / 移除 0 / 变更 3
  首见 jixoai/fde2e：首次出现依赖 @fission-ai/openspec@1.14.1（devDependencies）
  首见 jixoai/fde2e：首次出现依赖 http-proxy-3@1.22.0（devDependencies）
  首见 jixoai/fde2e：首次出现依赖 sirv@3.0.2（devDependencies）

[github-stars] 新增 0 / 移除 0 / 变更 3

[x-likes] 新增 9 / 移除 0 / 变更 0
  kind 分布 {"liked":8,"posted":1}
```
