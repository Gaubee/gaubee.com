# 工具工坊登记簿

> 状态：`proposed` 待裁决 → `approved` 保留 / `rejected` 否定 / `iterated` 迭代中（已保留且继续改）。
> kzf 裁决时由 agent 更新状态并在备注写理由；行只追加不删除。

| 日期       | 工具         | 路径                           | 一句话                                                                                      | 状态     | 裁决备注 |
| ---------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------- | -------- | -------- |
| 2026-10-03 | stars-search | tools/2026-10-03-stars-search/ | 本地星标多关键词速查（分类/语言过滤）——回答"收藏里有没有 X"的可验证候选器                   | proposed |          |
| 2026-10-03 | stale-check  | tools/2026-10-03-stale-check/  | 收藏保鲜检查：archived 与超 N 年未推送的仓库按分类盘点（首跑：119 archived / 138 stale@5y） | proposed |          |
| 2026-10-04 | deps-why     | tools/2026-10-04-deps-why/     | “我在哪里用的 X？”——依赖按项目溯源（版本/分区/首见时间，存量如实标注）                      | proposed |          |
| 2026-10-04 | star-at      | tools/2026-10-04-star-at/      | 收藏序号查询：order 字段第一个消费者（正查 #N / 反查仓库名）                                | proposed |          |
| 2026-10-05 | x-media-audit | tools/2026-10-05-x-media-audit/ | X 媒体库对账（Phase 3 重写）：引用 ↔ manifest∪staging 对账（断链/待打包/待清理/孤儿）+ 本地化缺口（原 100MB push 门禁随媒体出 git 废除） | proposed |          |
| 2026-10-05 | x-search     | tools/2026-10-05-x-search/     | X 动态 3025 条速查：多关键词 AND + kind/作者/媒体/时间过滤 + --json 管道（--nolocal 与对账缺口口径互证） | proposed |          |
| 2026-10-07 | manifest-lint | tools/2026-10-07-manifest-lint/ | cdn-media 清单体检：指针 sha256/offset 对齐/key 格式/卷集合一致 + 可选远端抽检（首跑 3413 对象 104 卷全过） | proposed |          |
| 2026-10-07 | event-frontmatter-lint | tools/2026-10-07-event-frontmatter-lint/ | 站点 events frontmatter 体检：报告类 title R2 规范/date/tags/媒体断链（首跑 1325 event、4510 引用 0 断链） | proposed |          |
