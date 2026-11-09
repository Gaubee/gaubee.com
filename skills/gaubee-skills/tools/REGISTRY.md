# 工具工坊登记簿

> 状态：`proposed` 待裁决 → `approved` 保留 / `rejected` 否定 / `iterated` 迭代中（已保留且继续改）。
> kzf 裁决时由 agent 更新状态并在备注写理由；行只追加不删除。

| 日期       | 工具         | 路径                           | 一句话                                                                                      | 状态     | 裁决备注 |
| ---------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------- | -------- | -------- |
| 2026-10-11 | x-daily-backfill | tools/2026-10-11-x-daily-backfill/ | X 日报缺口检测——有归档无日报的日子 + 差分运行日建议与补跑命令 | approved |          |
| 2026-10-11 | avatar-healthcheck | tools/2026-10-11-avatar-healthcheck/ | 作者头像 URL 健康抽样（404 检出 → backfill --ids 指引），防归档裂图 | approved |          |
| 2026-10-10 | patch-precheck | tools/2026-10-10-patch-precheck/ | cdn-media 同日补丁卷闸门预检——cron 第 4 步前置，撞名组动手前就知道 | approved |          |
| 2026-10-10 | translations-doctor | tools/2026-10-10-translations-doctor/ | X 译文覆盖率体检（按日缺口 + 门禁退出码），配套 export/merge 三件套 | approved |          |
| 2026-10-03 | stars-search | tools/2026-10-03-stars-search/ | 本地星标多关键词速查（分类/语言过滤）——回答"收藏里有没有 X"的可验证候选器                   | approved |          |
| 2026-10-03 | stale-check  | tools/2026-10-03-stale-check/  | 收藏保鲜检查：archived 与超 N 年未推送的仓库按分类盘点（首跑：119 archived / 138 stale@5y） | approved |          |
| 2026-10-04 | deps-why     | tools/2026-10-04-deps-why/     | “我在哪里用的 X？”——依赖按项目溯源（版本/分区/首见时间，存量如实标注）                      | approved |          |
| 2026-10-04 | star-at      | tools/2026-10-04-star-at/      | 收藏序号查询：order 字段第一个消费者（正查 #N / 反查仓库名）                                | approved |          |
| 2026-10-05 | x-media-audit | tools/2026-10-05-x-media-audit/ | X 媒体库对账（Phase 3 重写）：引用 ↔ manifest∪staging 对账（断链/待打包/待清理/孤儿）+ 本地化缺口（原 100MB push 门禁随媒体出 git 废除） | approved |          |
| 2026-10-05 | x-search     | tools/2026-10-05-x-search/     | X 动态 3025 条速查：多关键词 AND + kind/作者/媒体/时间过滤 + --json 管道（--nolocal 与对账缺口口径互证） | approved |          |
| 2026-10-07 | manifest-lint | tools/2026-10-07-manifest-lint/ | cdn-media 清单体检：指针 sha256/offset 对齐/key 格式/卷集合一致 + 可选远端抽检（首跑 3413 对象 104 卷全过） | approved |          |
| 2026-10-07 | event-frontmatter-lint | tools/2026-10-07-event-frontmatter-lint/ | 站点 events frontmatter 体检：报告类 title R2 规范/date/tags/媒体断链（首跑 1325 event、4510 引用 0 断链） | approved |          |
| 2026-10-08 | taxonomy-count-doctor | tools/2026-10-08-taxonomy-count-doctor/ | taxonomy 括号计数体检：对账 categorize --stats 权威值，--fix 带备份修正（首跑抓出 2 处历史漂移并修正） | approved |          |
| 2026-10-08 | ci-duration-trends | tools/2026-10-08-ci-duration-trends/ | Actions 耗时趋势速览：按 workflow 分组均值/极值/近5次趋势 + 最耗时 top5（首跑实证 Docker 构建均值 13m41s→2m49s） | approved |          |
| 2026-10-09 | pipeline-env-doctor | tools/2026-10-09-pipeline-env-doctor/ | 管道环境自检：二进制/gh 登录/数据根可写/.env 键名（首跑复现裁剪 PATH 故障 exit 1，修复后 12 项全绿） | approved |          |
| 2026-10-09 | x-window-entries | tools/2026-10-09-x-window-entries/ | X 日报 T-1 本地日窗选择器：UTC 窗口换算+媒体 manifest 对账（首跑与人工筛选 3/3 一致，并抓出 10-07 窗口 1 条迟到期） | approved |          |
| 2026-10-13 | deploy-smoke | tools/2026-10-13-deploy-smoke/ | 发布后公网冒烟：最新 N 篇 event 详情页 GET 断言（200/非壳/非 WAF 拦截页/title 匹配）——首跑即复现 WAF `.git` 误伤事故面 | approved |          |
| 2026-10-13 | ai-tone-one | tools/2026-10-13-ai-tone-one/ | ai-tone 单文件体检 wrapper：只出目标文件的段与退出码（原脚本无参数处理全目录扫描；退出码可直接接发布门禁） | approved |          |
| 2026-10-14 | git-ahead-guard | tools/2026-10-14-git-ahead-guard/ | 发布预检「本地超前」守卫：rev-list 对 origin/main 计数，ahead>0 列待推提交（aaa55d49f 忘推实证；publish 预检只查落后不查超前的补位） | approved |          |
| 2026-10-14 | deps-digest | tools/2026-10-14-deps-digest/ | 依赖变更人话化：相邻 history 快照对比出「X 1.0→2.0/新增/移除」明细（首跑实证 changes.bumpedCount 口径宽于快照真值，日报可诚实区分升级与抖动） | approved |          |
| 2026-10-14 | event-date-anchor | tools/2026-10-14-event-date-anchor/ | 报告类 event 日期锚定修复（kzf R8 裁决的存量执行）：19 处漂移/缺失 frontmatter 一次修复，幂等可重跑（publish 直通 bug 的 9 份 + 发布时刻 date 的 10 份） | approved |          |
| 2026-10-15 | manifest-lag-watch | tools/2026-10-15-manifest-lag-watch/ | 服务器交付滞后早警：本地指针 gen vs admin stats gen + token 认证探针（token 失效静默降级的早警，比公网 404 早一个发布周期） | approved |          |
| 2026-10-15 | daily-digest | tools/2026-10-15-daily-digest/ | 日报动笔前跨源事实清单：各源计数 + deps 首见明细 + X kind 分布，changes 日与报告日双标注（T-1 防误引） | approved |          |
| 2026-10-16 | token-swap-apply | tools/2026-10-16-token-swap-apply/ | CDN token 更换一键应用：本地双探针验证→服务器侧替换（stdin 传值+备份）→重建轮询 gen 追平→媒体抽验收据；坏 token 永不进 compose（ABORT 路径已实测） | approved |          |
| 2026-10-16 | deps-jitter-report | tools/2026-10-16-deps-jitter-report/ | deps changes 重复抖动仓识别：点名次数 vs 快照真实变化次数（首跑实证三仓连续 7 天点名零版本变化，21 次点名全为噪声） | approved |          |
| 2026-10-17 | star-flow-weekly | tools/2026-10-17-star-flow-weekly/ | 星标兴趣周流向：过去 N 天星标按 taxonomy/catalog 分类聚合（分类计数+带行为日期明细），周一周报主题聚类直接引用 | approved |          |
| 2026-10-17 | deps-jitter-probe | tools/2026-10-17-deps-jitter-probe/ | deps 日噪根因解剖：远端 package.json 依赖表 vs 本地快照逐项对比（首跑判定 B 成立：三仓内容零变化，changed[] 为 fetcher 误报，为 fetch 定点修复留证） | approved |          |
| 2026-10-18 | cron-day-briefing | tools/2026-10-18-cron-day-briefing/ | 每日维护开工面板：今天/YESTERDAY/星期几 + 周一专属步骤判定 + 近 3 天 changes→日报对照（把周日误当周一事故的开机防线） | approved |          |
| 2026-10-18 | t1-window-guard | tools/2026-10-18-t1-window-guard/ | T-1 归窗硬守卫：报告日 < 差分运行日 + 常规应为昨天 + --scan 批量体检 frontmatter（事故场景实测 FAIL 拦截） | approved |          |
| 2026-10-19 | oauth-flow-smoke | tools/2026-10-19-oauth-flow-smoke/ | 登录链路冒烟断言：健康检查+OAuth 302+client_id/redirect_uri/cookie 五断言（auth 自托管上线的回归门，client_id=undefined 事故实测可拦） | approved |          |
| 2026-10-19 | media-meta-freshness | tools/2026-10-19-media-meta-freshness/ | media-meta 悬空守卫：manifest 当前代对象键 vs media-meta.json 覆盖对账，缺口非零 exit 1（10-18 media-meta 未接入管道事故的复发防线，fixture FAIL 路径已实测） | approved |          |
| 2026-10-20 | auth-server-deploy | tools/2026-10-20-auth-server-deploy/ | auth-server 一键部署器：交叉编译+scp+原子替换+健康断言+失败自动回滚（真实部署 exit 0、回滚演练 exit 1 双路径实测） | approved |          |
| 2026-10-20 | x-posters-backfill | tools/2026-10-20-x-posters-backfill/ | 视频 poster 缺口审计+回灌：全库 <video> 覆盖对账（首跑 1202 缺 78）+staging 副本 ffmpeg 抽首帧 + x.json posterLocal 接线 + 重渲染（首版只写文件漏接线被审计判 30 孤儿，补课后覆盖 1124→1157） | approved |          |
| 2026-10-20 | video-retro-hd | tools/2026-10-20-video-retro-hd/ | 存量低清视频追溯升级：重拉 1080p/720p 源→无损切 HLS 分片→改键→重渲染；--until 给 cron 让路、--no-render/--render-pending 让页面引用等媒体发布（首跑 47 分钟视频 360p→720p 472 段 235MB；候选 332） | approved |          |
| 2026-10-21 | hls-live-check | tools/2026-10-21-hls-live-check/ | 线上 HLS 内容级验收：playlist MIME/#EXTM3U + 首段 video/mp2t + 事件页引用三方对齐，四态收据（OK/MEDIA_ONLY/UNPUBLISHED/BROKEN）；直连源站绕开代理与 fake-ip（首跑过渡态 UNPUBLISHED 3，预期 cron 后转 OK） | approved |          |
| 2026-10-22 | x-session-probe | tools/2026-10-22-x-session-probe/ | X 会话健康探针（抓取前置门禁）：书签页 8 秒判定登录态，登录流重定向 exit 1 早警；沉淀新登录墙 /i/jf/onboarding 与 /i/bookmarks→/i/history 重定向两处实测形态 | approved |          |
| 2026-10-22 | cdn-usage-report | tools/2026-10-22-cdn-usage-report/ | cdn-media 用量与增长报告（R2 决策支持）：最新代按月统计 + 相邻代补丁增量 + 代际趋势与单代最大增量 + 500MB 水位建议，全本地零网络秒级退出 | approved |          |
| 2026-10-23 | retro-status | tools/2026-10-23-retro-status/ | HLS 追溯完成度报告：全库视频 HLS 化/候选/无增益分布 + 剩余按月 + 续跑命令（首跑：1208 条视频已 HLS 120，候选 332→3，实质追平） | approved |          |
| 2026-10-23 | xd-window-audit | tools/2026-10-23-xd-window-audit/ | X 日报归窗对账：changes added 逐条核对「恰一窗」（报告日=R−1），缺窗/重复 exit 1（首跑 151 条恰一窗 114，异常 37 全为 10-18 定窗前历史代差，10-18 起全净） | approved |          |
| 2026-10-24 | x-thread-backfill | tools/2026-10-24-x-thread-backfill/ | X 线程兜底工具化：扫描疑似缺链（🧵/n/m 标记无 thread 字段）+ ego-browser 抓同作者全链原子写回（首跑 36 条疑似缺链；DeepSeek 1/6 线程实抓 6 段收尾对齐） | approved |          |
| 2026-10-24 | trans-quality-sampler | tools/2026-10-24-trans-quality-sampler/ | 译文质量抽查器：随机抽样原文/译文对照 + URL/emoji 保留率 + 机械红旗（首跑 n=8 抓到 2 条 t.co 残留——历史译文带原文没有的短链） | approved |          |
| 2026-10-25 | stars-drift | tools/2026-10-25-stars-drift/ | 星标兴趣漂移月览：catalog 分类 × starred_at 双窗口聚合 + 主力语言（首跑：近 30 天 90 星 vs 前 54，AI Agent 类 +21 近两倍漂移） | approved |          |
| 2026-10-25 | vault-verify | tools/2026-10-25-vault-verify/ | vault.enc.sqlite 只读校验：逐行 GCM 解密 + 行内哈希 + --workspace 双向对账（首跑 171 行全绿，抓到 taxonomy/profile/feedback-log 3 条已改未回灌） | approved |          |
| 2026-10-26 | x-top-authors | tools/2026-10-26-x-top-authors/ | X 点赞作者榜：x.json liked 按作者聚合双窗口计数（首跑：30 天 228 条赞 top10 占 38，@bkdgiffug 7 条居首） | approved |          |
| 2026-10-26 | vault-drift-sync | tools/2026-10-26-vault-drift-sync/ | vault 漂移回灌（vault-verify 姊妹动作）：agent 脚本直写绕过加密镜像的分叉一键补齐，vaultPut 语义幂等（首跑 dry 3 → 回灌 3 → 复核归零，实证根因为 python 直写 taxonomy） | approved |          |
| 2026-10-27 | pipeline-gap-check | tools/2026-10-27-pipeline-gap-check/ | 每日管道漏跑门禁：四源 changes（按各自命名口径）+ 双日报 event 对账，缺口 exit 1（首跑即正确复现 10-21 会话事故形态；发布前缺口 2 = 未发布的双日报） | approved |          |
| 2026-10-27 | data-write | tools/2026-10-27-data-write/ | 私有数据安全写包装：writeFileAtomic 通道治「脚本直写绕过 vault 镜像」根因，盘写去重时镜像层仍对账（验证：taxonomy 漂移 1→0，测试残留双侧清理） | approved |          |
| 2026-10-28 | trans-tco-scrub | tools/2026-10-28-trans-tco-scrub/ | 译文 t.co 残留全库扫描与清洗：只剥译文多余短链（原文有的不动）；首跑 dry 抓到 1222 条/1610 链（占库近四成），--fix 因牵动大规模历史重渲染留 kzf 裁决 | approved |          |
| 2026-10-28 | remux-probe | tools/2026-10-28-remux-probe/ | 本地媒体无损重封装可行性探针：ffprobe 只读判读哪些流可 copy、字幕容器限制、数据流去留（staging 双样本实测：h264+aac 全 copy；无音轨动图不误报） | approved | 2026-11-08 kzf 授权 agent 自决：保留为 agent 内部工具（判断「这视频能不能无损换容器」时用），非用户日常入口 |
| 2026-10-29 | star-readme | tools/2026-10-29-star-readme/ | 星标仓库 README 首屏速览：catalog 模糊匹配 + gh api 抽首段（跳徽章/图片/目录），回答「这个 star 到底是干嘛的」（mkvgo 实测） | approved |          |
| 2026-10-29 | x-archive-coverage | tools/2026-10-29-x-archive-coverage/ | X 归档覆盖对账：posted/reposted 按日 vs 站点 x-archive-<date> 双侧核对（首跑抓到 10-02~04 真缺档 3 天 9 条；812 天孤档判读为 Data Archive 历史口径差异） | approved |          |
| 2026-10-30 | commits-digest | tools/2026-10-30-commits-digest/ | 日报提交素材一条命令：各仓公私分布 + 私有仓样本消息（本地素材，写入日报前须重写为人话——R5） | approved |          |
| 2026-10-30 | ssh-channel-doctor | tools/2026-10-30-ssh-channel-doctor/ | gaubee-cloud ssh 通道检查（lag-watch 前置早警）：known_hosts 快检 + kaku 在位 + BatchMode 试连，--fix 键缺失 keyscan 补录（首跑试连即 OK） | approved |          |
| 2026-10-31 | registry-digest | tools/2026-10-31-registry-digest/ | 工坊待裁决清单汇总卡：proposed 行汇总成打勾卡（--md 落文件），首跑揭底——53 个提案 0 裁决，裁决环节从未启动 | approved |          |
| 2026-10-31 | llm-mem-fit | tools/2026-10-31-llm-mem-fit/ | 端侧 LLM 内存适配估算：参数×位宽+KV 上界+运行时 vs 可用内存三档判定（首跑 1.7B/4bit 2.6GB 轻松、7B/8bit 11.3GB 贴线；KV 口径显式标注为 MHA 上界） | approved | 2026-11-08 kzf 授权 agent 自决：保留为 agent 内部工具（回答「这模型塞得进 16GB Mac 吗」时算账），非用户日常入口 |
| 2026-11-04 | catchup-scan | tools/2026-11-04-catchup-scan/ | 补跑缺口扫描：区间内逐日核对四源 changes + 双日报，硬缺口（commits/GitHub 日报）与累积差分源的正常缺口分离（11-04 补跑即按此表执行） | approved |          |
| 2026-11-04 | x-daily-guard | tools/2026-11-04-x-daily-guard/ | X 日报归窗防线：发布前查目标日报的推文是否跨窗重复（11-04 抓到生成器给出的 10-31 重复窗；另抓出 10-22/10-23 两条历史跨窗条目） | approved |          |
| 2026-11-05 | cdn-cache-doctor | tools/2026-11-05-cdn-cache-doctor/ | cdn-base 缓存/单飞滞留探测：inflight_reserved 两次相同即判滞留（11-04 锁泄漏事故的工具化），附缓存水位与真实对象抽样、gen 滞后提示 | approved |          |
| 2026-11-05 | star-timeline | tools/2026-11-05-star-timeline/ | 星标时间线：按 starred_at 精确输出每日新增与期末累计（补跑时「总数」心算差一的根治；首跑复现 1731/1739/1740/1748/1749 口径） | approved |          |
| 2026-11-06 | media-unref-report | tools/2026-11-06-media-unref-report/ | 已入卷但无内容引用的媒体盘点（存储/R2 决策用）：manifest 全量 vs 站点引用，按月与体积汇总（首跑 74 对象/79MB=1.2%，大头是 HLS 化后的旧 mp4） | approved |          |
| 2026-11-06 | report-lint | tools/2026-11-06-report-lint/ | 报告一致性门禁：已发布报告的占位残留 + 日报「总数」与 starred_at 实际累计对账（首跑抓出已发布 01869 的总数少 3，已修正报告源与事件） | approved |          |
| 2026-11-07 | vol-name-plan | tools/2026-11-07-vol-name-plan/ | 补丁卷名排期预演：未来 N 天各月份组卷名、跨月撞名实际落成什么名字、当月组哪天只能等（补 patch-precheck 只看当天） | approved |          |
| 2026-11-07 | x-daily-trans-coverage | tools/2026-11-07-x-daily-trans-coverage/ | X 日报渲染产物译文覆盖率审计：逐条判语言并点名「非中文没译文」（首跑抓到日文漏译 1 条，已补译并归零） | approved |          |
| 2026-11-08 | nav-effect-lint | tools/2026-11-08-nav-effect-lint/ | 后台保活视图「抢导航」静态检查：$effect 内导航必须判前台（isActive/useActive），外壳级例外标 nav-effect-allow（用修复前 EventView 回归，抓到 3 处） | approved |          |
| 2026-11-08 | x-daily-thread-gaps | tools/2026-11-08-x-daily-thread-gaps/ | X 日报线程标记缺链审计：按报告日逐条查 🧵/n-m 与 thread，直接给出 --ids 命令（首跑确认 11-07 hunch 已补链，演示删链可检出） | approved |          |
| 2026-11-09 | x-daily-staleness | tools/2026-11-09-x-daily-staleness/ | X 日报陈旧稿检测：译文已入库但日报没渲染译/原切换的条目（今日人眼在 10-18/10-29 各抓到 1 条，工具化后全量 0 陈旧） | proposed |          |
| 2026-11-09 | stars-integrity-audit | tools/2026-11-09-stars-integrity-audit/ | 星标完整性审计：改名配对（OpenMontage 换 owner）+ starred_at 静默修订（cicada 11-03→11-08，解释 report-lint 漂移） | proposed |          |
| 2026-11-10 | weekly-digest | tools/2026-11-10-weekly-digest/ | 周报动笔前的跨源素材：区间内各仓提交数与代表消息、星标按 taxonomy 分类、X 按 kind 计数（11-02~08 首跑 7 仓/24 星标/6 组 X） | proposed |          |
| 2026-11-10 | repo-rename-reconciler | tools/2026-11-10-repo-rename-reconciler/ | 星标改名对账（gh 301 探测）：抓「改名+改描述」漏网（douyin-comments→saas-growth-agents），核对 taxonomy 引用 | proposed |          |
