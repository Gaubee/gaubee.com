# 工具工坊登记簿

> 状态：`proposed` 待裁决 → `approved` 保留 / `rejected` 否定 / `iterated` 迭代中（已保留且继续改）。
> kzf 裁决时由 agent 更新状态并在备注写理由；行只追加不删除。

| 日期       | 工具         | 路径                           | 一句话                                                                                      | 状态     | 裁决备注 |
| ---------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------- | -------- | -------- |
| 2026-10-11 | x-daily-backfill | tools/2026-10-11-x-daily-backfill/ | X 日报缺口检测——有归档无日报的日子 + 差分运行日建议与补跑命令 | proposed |          |
| 2026-10-11 | avatar-healthcheck | tools/2026-10-11-avatar-healthcheck/ | 作者头像 URL 健康抽样（404 检出 → backfill --ids 指引），防归档裂图 | proposed |          |
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
| 2026-10-13 | deploy-smoke | tools/2026-10-13-deploy-smoke/ | 发布后公网冒烟：最新 N 篇 event 详情页 GET 断言（200/非壳/非 WAF 拦截页/title 匹配）——首跑即复现 WAF `.git` 误伤事故面 | proposed |          |
| 2026-10-13 | ai-tone-one | tools/2026-10-13-ai-tone-one/ | ai-tone 单文件体检 wrapper：只出目标文件的段与退出码（原脚本无参数处理全目录扫描；退出码可直接接发布门禁） | proposed |          |
| 2026-10-14 | git-ahead-guard | tools/2026-10-14-git-ahead-guard/ | 发布预检「本地超前」守卫：rev-list 对 origin/main 计数，ahead>0 列待推提交（aaa55d49f 忘推实证；publish 预检只查落后不查超前的补位） | proposed |          |
| 2026-10-14 | deps-digest | tools/2026-10-14-deps-digest/ | 依赖变更人话化：相邻 history 快照对比出「X 1.0→2.0/新增/移除」明细（首跑实证 changes.bumpedCount 口径宽于快照真值，日报可诚实区分升级与抖动） | proposed |          |
| 2026-10-14 | event-date-anchor | tools/2026-10-14-event-date-anchor/ | 报告类 event 日期锚定修复（kzf R8 裁决的存量执行）：19 处漂移/缺失 frontmatter 一次修复，幂等可重跑（publish 直通 bug 的 9 份 + 发布时刻 date 的 10 份） | proposed |          |
| 2026-10-15 | manifest-lag-watch | tools/2026-10-15-manifest-lag-watch/ | 服务器交付滞后早警：本地指针 gen vs admin stats gen + token 认证探针（token 失效静默降级的早警，比公网 404 早一个发布周期） | proposed |          |
| 2026-10-15 | daily-digest | tools/2026-10-15-daily-digest/ | 日报动笔前跨源事实清单：各源计数 + deps 首见明细 + X kind 分布，changes 日与报告日双标注（T-1 防误引） | proposed |          |
| 2026-10-16 | token-swap-apply | tools/2026-10-16-token-swap-apply/ | CDN token 更换一键应用：本地双探针验证→服务器侧替换（stdin 传值+备份）→重建轮询 gen 追平→媒体抽验收据；坏 token 永不进 compose（ABORT 路径已实测） | proposed |          |
| 2026-10-16 | deps-jitter-report | tools/2026-10-16-deps-jitter-report/ | deps changes 重复抖动仓识别：点名次数 vs 快照真实变化次数（首跑实证三仓连续 7 天点名零版本变化，21 次点名全为噪声） | proposed |          |
| 2026-10-17 | star-flow-weekly | tools/2026-10-17-star-flow-weekly/ | 星标兴趣周流向：过去 N 天星标按 taxonomy/catalog 分类聚合（分类计数+带行为日期明细），周一周报主题聚类直接引用 | proposed |          |
| 2026-10-17 | deps-jitter-probe | tools/2026-10-17-deps-jitter-probe/ | deps 日噪根因解剖：远端 package.json 依赖表 vs 本地快照逐项对比（首跑判定 B 成立：三仓内容零变化，changed[] 为 fetcher 误报，为 fetch 定点修复留证） | proposed |          |
| 2026-10-18 | cron-day-briefing | tools/2026-10-18-cron-day-briefing/ | 每日维护开工面板：今天/YESTERDAY/星期几 + 周一专属步骤判定 + 近 3 天 changes→日报对照（把周日误当周一事故的开机防线） | proposed |          |
| 2026-10-18 | t1-window-guard | tools/2026-10-18-t1-window-guard/ | T-1 归窗硬守卫：报告日 < 差分运行日 + 常规应为昨天 + --scan 批量体检 frontmatter（事故场景实测 FAIL 拦截） | proposed |          |
| 2026-10-19 | oauth-flow-smoke | tools/2026-10-19-oauth-flow-smoke/ | 登录链路冒烟断言：健康检查+OAuth 302+client_id/redirect_uri/cookie 五断言（auth 自托管上线的回归门，client_id=undefined 事故实测可拦） | proposed |          |
| 2026-10-19 | media-meta-freshness | tools/2026-10-19-media-meta-freshness/ | media-meta 悬空守卫：manifest 当前代对象键 vs media-meta.json 覆盖对账，缺口非零 exit 1（10-18 media-meta 未接入管道事故的复发防线，fixture FAIL 路径已实测） | proposed |          |
| 2026-10-20 | auth-server-deploy | tools/2026-10-20-auth-server-deploy/ | auth-server 一键部署器：交叉编译+scp+原子替换+健康断言+失败自动回滚（真实部署 exit 0、回滚演练 exit 1 双路径实测） | proposed |          |
| 2026-10-20 | x-posters-backfill | tools/2026-10-20-x-posters-backfill/ | 视频 poster 缺口审计+回灌：全库 <video> 覆盖对账（首跑 1202 缺 78）+staging 副本 ffmpeg 抽首帧 + x.json posterLocal 接线 + 重渲染（首版只写文件漏接线被审计判 30 孤儿，补课后覆盖 1124→1157） | proposed |          |
| 2026-10-20 | video-retro-hd | tools/2026-10-20-video-retro-hd/ | 存量低清视频追溯升级：重拉 1080p/720p 源→无损切 HLS 分片→改键→重渲染；--until 给 cron 让路、--no-render/--render-pending 让页面引用等媒体发布（首跑 47 分钟视频 360p→720p 472 段 235MB；候选 332） | proposed |          |
| 2026-10-21 | hls-live-check | tools/2026-10-21-hls-live-check/ | 线上 HLS 内容级验收：playlist MIME/#EXTM3U + 首段 video/mp2t + 事件页引用三方对齐，四态收据（OK/MEDIA_ONLY/UNPUBLISHED/BROKEN）；直连源站绕开代理与 fake-ip（首跑过渡态 UNPUBLISHED 3，预期 cron 后转 OK） | proposed |          |
| 2026-10-22 | x-session-probe | tools/2026-10-22-x-session-probe/ | X 会话健康探针（抓取前置门禁）：书签页 8 秒判定登录态，登录流重定向 exit 1 早警；沉淀新登录墙 /i/jf/onboarding 与 /i/bookmarks→/i/history 重定向两处实测形态 | proposed |          |
| 2026-10-22 | cdn-usage-report | tools/2026-10-22-cdn-usage-report/ | cdn-media 用量与增长报告（R2 决策支持）：最新代按月统计 + 相邻代补丁增量 + 代际趋势与单代最大增量 + 500MB 水位建议，全本地零网络秒级退出 | proposed |          |
| 2026-10-23 | retro-status | tools/2026-10-23-retro-status/ | HLS 追溯完成度报告：全库视频 HLS 化/候选/无增益分布 + 剩余按月 + 续跑命令（首跑：1208 条视频已 HLS 120，候选 332→3，实质追平） | proposed |          |
| 2026-10-23 | xd-window-audit | tools/2026-10-23-xd-window-audit/ | X 日报归窗对账：changes added 逐条核对「恰一窗」（报告日=R−1），缺窗/重复 exit 1（首跑 151 条恰一窗 114，异常 37 全为 10-18 定窗前历史代差，10-18 起全净） | proposed |          |
