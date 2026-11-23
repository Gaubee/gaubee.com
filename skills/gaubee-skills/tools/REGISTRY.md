# 工具工坊登记簿

> 状态：`proposed` 待裁决 → `approved` 保留 / `rejected` 否定 / `iterated` 迭代中（已保留且继续改）。
> kzf 裁决时由 agent 更新状态并在备注写理由；行只追加不删除。

| 日期       | 工具         | 路径                           | 一句话                                                                                      | 状态     | 形态     | 裁决备注 |
| ---------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------- | -------- | ------- | -------- |
| 2026-10-03 | stars-search | tools/2026-10-03-stars-search/ | 本地星标多关键词速查（分类/语言过滤）——回答"收藏里有没有 X"的可验证候选器                   | approved | webapp |          |
| 2026-10-03 | stale-check  | tools/2026-10-03-stale-check/  | 收藏保鲜检查：archived 与超 N 年未推送的仓库按分类盘点（首跑：119 archived / 138 stale@5y） | approved | webapp |          |
| 2026-10-04 | deps-why     | tools/2026-10-04-deps-why/     | “我在哪里用的 X？”——依赖按项目溯源（版本/分区/首见时间，存量如实标注）                      | approved | webapp |          |
| 2026-10-04 | star-at      | tools/2026-10-04-star-at/      | 收藏序号查询：order 字段第一个消费者（正查 #N / 反查仓库名）                                | approved | webapp |          |
| 2026-10-05 | x-search     | tools/2026-10-05-x-search/     | X 动态 3025 条速查：多关键词 AND + kind/作者/媒体/时间过滤 + --json 管道（--nolocal 与对账缺口口径互证） | approved | webapp |          |
| 2026-10-14 | deps-digest | tools/2026-10-14-deps-digest/ | 依赖变更人话化：相邻 history 快照对比出「X 1.0→2.0/新增/移除」明细（首跑实证 changes.bumpedCount 口径宽于快照真值，日报可诚实区分升级与抖动） | approved | webapp |          |
| 2026-10-16 | token-swap-apply | tools/2026-10-16-token-swap-apply/ | CDN token 更换一键应用：本地双探针验证→服务器侧替换（stdin 传值+备份）→重建轮询 gen 追平→媒体抽验收据；坏 token 永不进 compose（ABORT 路径已实测） | approved | self-hosted |          |
| 2026-10-17 | star-flow-weekly | tools/2026-10-17-star-flow-weekly/ | 星标兴趣周流向：过去 N 天星标按 taxonomy/catalog 分类聚合（分类计数+带行为日期明细），周一周报主题聚类直接引用 | approved | webapp |          |
| 2026-10-20 | auth-server-deploy | tools/2026-10-20-auth-server-deploy/ | auth-server 一键部署器：交叉编译+scp+原子替换+健康断言+失败自动回滚（真实部署 exit 0、回滚演练 exit 1 双路径实测） | approved | self-hosted |          |
| 2026-10-20 | x-posters-backfill | tools/2026-10-20-x-posters-backfill/ | 视频 poster 缺口审计+回灌：全库 <video> 覆盖对账（首跑 1202 缺 78）+staging 副本 ffmpeg 抽首帧 + x.json posterLocal 接线 + 重渲染（首版只写文件漏接线被审计判 30 孤儿，补课后覆盖 1124→1157） | approved | self-hosted |          |
| 2026-10-20 | video-retro-hd | tools/2026-10-20-video-retro-hd/ | 存量低清视频追溯升级：重拉 1080p/720p 源→无损切 HLS 分片→改键→重渲染；--until 给 cron 让路、--no-render/--render-pending 让页面引用等媒体发布（首跑 47 分钟视频 360p→720p 472 段 235MB；候选 332） | approved | self-hosted |          |
| 2026-10-24 | x-thread-backfill | tools/2026-10-24-x-thread-backfill/ | X 线程兜底工具化：扫描疑似缺链（🧵/n/m 标记无 thread 字段）+ ego-browser 抓同作者全链原子写回（首跑 36 条疑似缺链；DeepSeek 1/6 线程实抓 6 段收尾对齐） | approved | self-hosted |          |
| 2026-10-25 | stars-drift | tools/2026-10-25-stars-drift/ | 星标兴趣漂移月览：catalog 分类 × starred_at 双窗口聚合 + 主力语言（首跑：近 30 天 90 星 vs 前 54，AI Agent 类 +21 近两倍漂移） | approved | webapp |          |
| 2026-10-25 | vault-verify | tools/2026-10-25-vault-verify/ | vault.enc.sqlite 只读校验：逐行 GCM 解密 + 行内哈希 + --workspace 双向对账（首跑 171 行全绿，抓到 taxonomy/profile/feedback-log 3 条已改未回灌） | approved | self-hosted |          |
| 2026-10-26 | x-top-authors | tools/2026-10-26-x-top-authors/ | X 点赞作者榜：x.json liked 按作者聚合双窗口计数（首跑：30 天 228 条赞 top10 占 38，@bkdgiffug 7 条居首） | approved | webapp |          |
| 2026-10-26 | vault-drift-sync | tools/2026-10-26-vault-drift-sync/ | vault 漂移回灌（vault-verify 姊妹动作）：agent 脚本直写绕过加密镜像的分叉一键补齐，vaultPut 语义幂等（首跑 dry 3 → 回灌 3 → 复核归零，实证根因为 python 直写 taxonomy） | approved | self-hosted |          |
| 2026-10-28 | remux-probe | tools/2026-10-28-remux-probe/ | 本地媒体无损重封装可行性探针：ffprobe 只读判读哪些流可 copy、字幕容器限制、数据流去留（staging 双样本实测：h264+aac 全 copy；无音轨动图不误报） | approved | self-hosted | 2026-11-08 kzf 授权 agent 自决：保留为 agent 内部工具（判断「这视频能不能无损换容器」时用），非用户日常入口 |
| 2026-10-29 | star-readme | tools/2026-10-29-star-readme/ | 星标仓库 README 首屏速览：catalog 模糊匹配 + gh api 抽首段（跳徽章/图片/目录），回答「这个 star 到底是干嘛的」（mkvgo 实测） | approved | webapp |          |
| 2026-10-31 | llm-mem-fit | tools/2026-10-31-llm-mem-fit/ | 端侧 LLM 内存适配估算：参数×位宽+KV 上界+运行时 vs 可用内存三档判定（首跑 1.7B/4bit 2.6GB 轻松、7B/8bit 11.3GB 贴线；KV 口径显式标注为 MHA 上界） | approved | webapp | 2026-11-08 kzf 授权 agent 自决：保留为 agent 内部工具（回答「这模型塞得进 16GB Mac 吗」时算账），非用户日常入口 |
| 2026-11-05 | star-timeline | tools/2026-11-05-star-timeline/ | 星标时间线：按 starred_at 精确输出每日新增与期末累计（补跑时「总数」心算差一的根治；首跑复现 1731/1739/1740/1748/1749 口径） | approved | webapp |          |

| 2026-10-09 | x-time0-migration | tools/2026-10-09-x-time0-migration/ | time=0 媒体路径迁移（一次性） | proposed | self-hosted |          |

> **internal 的工具已移出本簿**（2026-11-23 体力规则）：它们只服务维护管道，不占体力、不算工坊产出。
> 清单见 `tools/INTERNAL.md`；形态定义见 `openspec/changes/tool-body-economy`。
| 2026-11-24 | star-browse | tools/2026-11-24-star-browse/ | 按策展分类浏览收藏：16 个分类 184 个仓库，支持关键词按描述与仓库名过滤（webapp，已在 /app/tools） | proposed | webapp |  |
| 2026-11-24 | tech-adoption | tools/2026-11-24-tech-adoption/ | 技术采用时间线：查某技术何时首见、用在哪些项目，也能反查项目技术栈（webapp，读站点公开图谱） | proposed | webapp |  |
