# 工具工坊登记簿

> 状态：`proposed` 待裁决 → `approved` 保留 / `rejected` 否定 / `iterated` 迭代中（已保留且继续改）。
> kzf 裁决时由 agent 更新状态并在备注写理由；行只追加不删除。

| 日期       | 工具         | 路径                           | 一句话                                                                                      | 状态     | 裁决备注 |
| ---------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------- | -------- | -------- |
| 2026-10-10 | patch-precheck | tools/2026-10-10-patch-precheck/ | cdn-media 同日补丁卷闸门预检——cron 第 4 步前置，撞名组动手前就知道 | proposed |          |
| 2026-10-10 | translations-doctor | tools/2026-10-10-translations-doctor/ | X 译文覆盖率体检（按日缺口 + 门禁退出码），配套 export/merge 三件套 | proposed |          |
| 2026-10-03 | stars-search | tools/2026-10-03-stars-search/ | 本地星标多关键词速查（分类/语言过滤）——回答"收藏里有没有 X"的可验证候选器                   | proposed |          |
| 2026-10-03 | stale-check  | tools/2026-10-03-stale-check/  | 收藏保鲜检查：archived 与超 N 年未推送的仓库按分类盘点（首跑：119 archived / 138 stale@5y） | proposed |          |
| 2026-10-04 | deps-why     | tools/2026-10-04-deps-why/     | “我在哪里用的 X？”——依赖按项目溯源（版本/分区/首见时间，存量如实标注）                      | proposed |          |
| 2026-10-04 | star-at      | tools/2026-10-04-star-at/      | 收藏序号查询：order 字段第一个消费者（正查 #N / 反查仓库名）                                | proposed |          |
| 2026-10-05 | x-media-audit | tools/2026-10-05-x-media-audit/ | X 媒体库对账（Phase 3 重写）：引用 ↔ manifest∪staging 对账（断链/待打包/待清理/孤儿）+ 本地化缺口（原 100MB push 门禁随媒体出 git 废除） | proposed |          |
| 2026-10-05 | x-search     | tools/2026-10-05-x-search/     | X 动态 3025 条速查：多关键词 AND + kind/作者/媒体/时间过滤 + --json 管道（--nolocal 与对账缺口口径互证） | proposed |          |
| 2026-10-07 | manifest-lint | tools/2026-10-07-manifest-lint/ | cdn-media 清单体检：指针 sha256/offset 对齐/key 格式/卷集合一致 + 可选远端抽检（首跑 3413 对象 104 卷全过） | proposed |          |
| 2026-10-07 | event-frontmatter-lint | tools/2026-10-07-event-frontmatter-lint/ | 站点 events frontmatter 体检：报告类 title R2 规范/date/tags/媒体断链（首跑 1325 event、4510 引用 0 断链） | proposed |          |
| 2026-10-08 | taxonomy-count-doctor | tools/2026-10-08-taxonomy-count-doctor/ | taxonomy 括号计数体检：对账 categorize --stats 权威值，--fix 带备份修正（首跑抓出 2 处历史漂移并修正） | proposed |          |
| 2026-10-08 | ci-duration-trends | tools/2026-10-08-ci-duration-trends/ | Actions 耗时趋势速览：按 workflow 分组均值/极值/近5次趋势 + 最耗时 top5（首跑实证 Docker 构建均值 13m41s→2m49s） | proposed |          |
| 2026-10-09 | pipeline-env-doctor | tools/2026-10-09-pipeline-env-doctor/ | 管道环境自检：二进制/gh 登录/数据根可写/.env 键名（首跑复现裁剪 PATH 故障 exit 1，修复后 12 项全绿） | proposed |          |
| 2026-10-09 | x-window-entries | tools/2026-10-09-x-window-entries/ | X 日报 T-1 本地日窗选择器：UTC 窗口换算+媒体 manifest 对账（首跑与人工筛选 3/3 一致，并抓出 10-07 窗口 1 条迟到期） | proposed |          |
