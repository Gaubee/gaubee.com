---
name: gaubee-skills
description: kzf（Gaubee）的工作信号活档案、技能 Graph 与个人工具工坊：汇总 GitHub 星标、每日提交记录、项目依赖（新技术采用）、X (Twitter) 动态（发帖/转发/点赞/收藏）等信号，维护技能 Graph、品味画像与日报/周报/月报/年报（自动发布到 gaubee.com events）。当 kzf 问"推荐个工具/库"、"我收藏里有没有能做 X 的"、"我什么时候开始用 Y 技术的"、"我的项目栈里有什么"，要求基于他的收藏造小工具，对工具提案给出保留/否定/肯定裁决，或询问信号变更与报告时使用本 skill。
---

<!--
文件意图（正交意图清单）：
- [2026-10-03] 原始需求（kzf）："抓取我的 github star 整理成 skill；每天定时抓变更、更新 skill、出日报/周报/月报；我问你要工具时给建议；每天 CPU/磁盘空闲时造 2 个我可能用得到的小工具；从我的保留/否定中学习价值判断，持续迭代，全部沉淀到这个 skill。"
- [2026-10-03] 裁决一：否定单源命名 github-stars（未来加 X 与提交记录）；kzf 拍板定名 gaubee-skills。
- [2026-10-03] 裁决二（追加需求）：①报告（含年报）自动汇总发布到 ~/Dev/Github/gaubee.com 的 events；②每日提交记录入源，重点是 commit 用了什么新技术（依赖）→ 建立「技能 Graph」，stars、我的项目、项目依赖全部入图；③X 抓取走官方 CLI（xurl，已定）。
- [2026-10-03] 裁决三：X OAuth 回调端口不用 8080（易冲突），固定用 36000~36999 段 → `http://localhost:36080/callback`；App 凭证放 `.env`（X_APP_CLIENT_ID / X_APP_CLIENT_SECRET）。
- [2026-10-03] 裁决四：本 skill 放 `~/.agents/skills/`（跨 agent 通用），不放 ZCode 专属目录——个人基础设施默认做成 agent 无关的。
- [2026-10-05] 裁决五：本 skill 迁入 gaubee.com 仓库 `skills/gaubee-skills/`（`~/.agents/skills/gaubee-skills` 是指向仓库的软链，跨 agent 可发现性不变）。**隐私边界**：代码、写作法则、报告进仓库；含私有信号的数据（sources、本地 tech-graph、profile、feedback-log、research）与 `.env` 凭据一律放仓库外 `~/.gaubee-skills/`（`GAUBEE_SKILLS_DATA` 可覆盖），仓库 .gitignore 有双保险，绝不进 git。
- 1. 数据布局（多源分区，谁是事实源）
- 2. 数据源接入协议（源注册表 + 新源怎么加）
- 3. 技能 Graph（stars × 项目 × 依赖）
- 4. 发布到 gaubee.com（events 规范与部署链）
- 5. 工具推荐问答 playbook
- 6. 小工具工坊 playbook（每天 2 个）
- 7. 价值判断学习闭环
- 8. 自动化管道（定时任务与脚本）
-->

# gaubee-skills — 工作信号汇总 + 技能 Graph + 工具工坊

把 kzf 散落各处的「工作信号」（星标、提交记录、项目依赖、未来的 X 动态）汇总成一份活的档案：理解他的兴趣、技术与品味，回答"有什么工具可用 / 我什么时候开始用 X / 我的项目栈长什么样"，并每天提案 2 个小工具，用他的裁决持续校准。报告自动发布到他的网站。

## 1. 数据布局

**两个根**（2026-10-05 迁移裁决）：本目录（仓库内）放代码/法则/报告；**私有数据根 `~/.gaubee-skills/`**（`GAUBEE_SKILLS_DATA` 可覆盖）放一切含私有信号的产物——下表的 `data/…` 全部指 `~/.gaubee-skills/data/…`，绝不进 git。

**加密 vault（2026-10-05 跨设备方案，kzf 裁决）**：`~/.gaubee-skills/vault.enc.sqlite` 单文件 = bun:sqlite 每文件一行 AES-256-GCM 加密 blob（密钥从 .env 的 `GAUBEE_SKILLS_VAULT_KEY` scrypt 派生，零第三方依赖）。`lib.writeFileAtomic` 对 DATA 之下的写入**自动镜像加密**——写入即加密，无手动打包步骤；密文检查实证零明文泄漏。跨设备三步：①同步 vault 单文件（iCloud/Syncthing/私有 git 任选通道）＋从密码管理器取回 `.env`；②`bun scripts/vault.ts unlock` 恢复明文工作区（冷启动时 lib 导入也会自动解锁）；③照常干活，写入自动回灌 vault。`vault.ts lock` 清除明文工作区（`--keep` 保留；要"静态加密"就锁），`vault.ts status` 看状态，`vault.ts init` 生成密钥并首灌。

| 路径                                          | 是什么                                                                        | 维护方式                           |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| `data/sources/<source>/`                      | 各信号源分区（见 §2 源注册表）                                                | 各源脚本写入                       |
| `data/sources/github-stars/stars.json`        | 星标最新全量快照（该源事实源，1639 项基线）                                   | fetch 脚本写，勿手改               |
| `data/sources/github-commits/`                | 每日提交日志（history 按日 + changes 即当日提交）                             | commits-fetch 写                   |
| `data/sources/github-deps/`                   | 项目依赖快照（deps.json + history + changes 新技术首见事件）                  | deps-fetch 写                      |
| `data/taxonomy.md`                            | 策展分类法（星标分类地图）                                                    | agent 增量维护                     |
| `data/sources/github-stars/catalog.md`        | 星标全量索引（可重建，勿手改）                                                | categorize `--build-catalog`       |
| `data/tech-graph.json` / `data/tech-graph.md` | 技能 Graph（机器版/人读版）                                                   | tech-graph-build 重建，勿手改      |
| `data/tech-graph.html`                        | 技能 Graph 交互展示页（自包含，file:// 直接打开；**含私有仓信号，仅限本地**） | `build-graph-page.ts` 重建，勿手改 |
| `data/profile.md`                             | kzf 品味画像：兴趣 + 蒸馏后的价值规则                                         | agent 按裁决蒸馏更新               |
| `data/feedback-log.md`                        | 价值裁决原始日志（append-only，只加不改）                                     | agent 在 kzf 表态时追加            |
| `reports/{daily,weekly,monthly,yearly}/`      | 日报/周报/月报/年报                                                           | 定时任务生成骨架 + agent 补分析    |
| `tools/REGISTRY.md`                           | 工具提案登记簿（proposed/approved/rejected/iterated）                         | 造工具时追加，裁决时更新           |
| `tools/<YYYY-MM-DD>-<slug>/`                  | 每个提案工具一个目录（README + 源码）                                         | 工坊产出                           |

**数据约定（kzf 2026-10-04）**：条目有时间就用时间；**缺失的时间一律置 time=0（"1970-01-01"）**，排序自然最老；每类条目带 `order` 稳定序号（如 star 的收藏顺序：1 = 最早），时间缺失或同秒并列（现有 319 组）时用 order 兜底排序与指代。

## 2. 数据源接入协议

| source                             | 状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 抓取                              | 变更                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `github-stars`                     | ✅ 已上线                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `scripts/github-stars-fetch.ts`   | `scripts/github-stars-diff.ts`                                                 |
| `github-commits`                   | ✅ 已上线。认证事件流【含私有仓】：history 留全量（本地档案），**changes 是发布视图仅公开仓**（2026-10-03 隐私修复）。事件流翻页上限 5 页 ≈500 事件/天；提交明细经 compare API（before...head）补取                                                                                                                                                                                                                                                                                     | `scripts/github-commits-fetch.ts` | fetch 内直接写 changes（变更=当日提交）                                        |
| `github-deps`                      | ✅ 已上线。**仅 owner 仓库**（247 个，含私有；协作/组织仓暂不扫，列入扩展）；根 package.json，workspace 子包/Cargo 等留作扩展                                                                                                                                                                                                                                                                                                                                                           | `scripts/github-deps-fetch.ts`    | fetch 内直接写 changes（新技术首见事件）                                       |
| `x-likes`（X 发帖/转发/点赞/收藏） | ✅ 已上线，**browser 后端（默认）**：ego-browser 真实登录态抽取三条流（基线 55 条，2026-10-03），每流 3 轮视口封顶、只读、零密钥。xurl 官方通道 `--backend xurl` 为备用（已授权 @gaubeebangeel，app `kzf-agent`，但 402 credits depleted——绑卡送 $20 后可用）。历史回灌：`scripts/x-archive-import.ts`（官方 Data Archive，等归档下载）。坑：xurl 无 `get` 子命令；ego 的 nodejs 不透传自定义 env、stdin 管道会进 REPL（须 `-e`）；ego-browser 配置注入见 x-likes-browser.js 占位符约定 | `scripts/x-likes-fetch.ts`        | fetch 内直接写 changes（added=新动态，kind: posted/reposted/liked/bookmarked） |

接入新源的规约（满足即可零改动进报告管道）：

1. 分区：`data/sources/<source>/{<source>.json, history/, changes/}`。
2. 脚本：`scripts/<source>-fetch.ts`（stdout 输出 `BASELINE …` 或摘要行）+ 变更逻辑（独立 diff 脚本或 fetch 内写 changes），changes 结构对齐 `{date, added[], removed[], changed[]}`。
3. `scripts/build-report.ts` 逐源读 changes 目录，无需改代码。
4. 在上表登记状态；必要时给 taxonomy 增设板块。

## 3. 技能 Graph

stars（兴趣）、项目（我在维护的）、依赖（我在用的技术）三者入图：

```sh
bun scripts/tech-graph-build.ts     # 纯本地计算 → data/tech-graph.json + tech-graph.md
bun scripts/build-graph-page.ts     # → data/tech-graph.html 交互展示页（自包含，浏览器直接打开）
```

- 边：project —uses→ tech（meta.section 区分依赖分区）、user —uses→ project（meta.as=maintains，即"我维护的项目"）、user —stars→ repo、tech —echoes→ star（用着且收藏了 = 核心技能区）。
- 人读版内容：技术广度榜（≥2 项目使用）、新技术采用时间线（依赖首见日期）、项目技术栈、star 呼应。
- 「新技术采用」信号来自 github-deps 的 changes（依赖首见事件）；与当日提交在日报里可交叉印证。
- 回答"我什么时候开始用 X"→ 查 tech-graph.md 时间线或 deps history。

## 4. 发布到 gaubee.com

报告发布 = 在站点仓库新增 event（短评），push main 后 CI 构建镜像、1Panel 自动拉取上线（站点 `agents.md` 部署链）。

```sh
bun scripts/publish.ts <报告md> --slug <slug> --title "<标题>" --tags signals,daily
# 先 --dry 干跑确认；正式发布会自动：序号自增（如 00023.gaubee-xxx.md）+ front-matter（title/date/tags）+ 显式路径 add + 📰 中文提交 + push origin main
```

**title 规范（2026-10-06 kzf 裁决，全角冒号，事件应用「最近事件」widget 按 title 展示）**：
GitHub 日报 `GitHub 日报：2026-10-04`；X 日报 `X 日报：2026-10-05`；
GitHub 周报 `GitHub 周报：2026-09-28～2026-10-04`；GitHub 月报 `GitHub 月报：2026-09`；
GitHub 年报 `GitHub 年报：2026`。

护栏（脚本内置，勿绕过）：站点必须在 main 分支、无未提交的跟踪文件改动、不落后远端，否则中止；只 add 本次生成的单个文件。日报/周报正文写作时**不要用本机绝对路径**（会被发布到公开网站）；站内引用一律写可公开的相对描述。

**隐私红线（2026-10-03 事故教训）**：认证后的 GitHub 事件流包含私有仓活动。任何进入发布视图的内容（changes、日报、周月年报正文）**只允许出现公开仓信号**；私有仓信号仅存在于本地 history 与 tech-graph。发布前自检：正文里出现私有仓名/私有工作内容即违规。基线日各源 changes 为空属预期形态（自 diff 起才有数据）。

## 5. 工具推荐问答

当 kzf 要工具/库建议（"有没有做 X 的"、"推荐个 Y"）：

1. `rg` 查 `data/taxonomy.md` 定位分类；再 `rg` 查 `data/sources/github-stars/stars.json` 拿候选全集。
2. 结合 `data/profile.md` 规则排序过滤（被否定方向降权）；用 `stale-check` 意识避开死项目（🪦 标注）。
3. 给 3-5 个候选：**名字 + 一句话 + 为什么适合这个场景 + 关键取舍**；按贴合度排序，不堆清单。
4. 涉及"我在用的技术"时优先查 `data/tech-graph.md`（广度榜 = 他的真实栈）。
5. 收藏里没有趁手的 → 明确说"这是收藏空档"，并提示可以走造工具流程补上。

红线：引用必须能在 `stars.json` / `tech-graph.json` 里验证，禁止编造收藏里不存在的项目；推荐收藏之外的项目必须显式标注"不在你的收藏里"。

## 6. 小工具工坊

每天 2 个提案，由定时任务的运行内直接完成（闲时队列当前对本账号不可用，见 §8）。

- **点子优先级**：`profile.md` 记录的痛点/需求 > 最近信号暴露的兴趣 > 收藏里的能力空档。避开 `REGISTRY.md` 已否定方向。
- **铁律**：小而真——50 行解决一个具体痛点 > 500 行框架；零第三方依赖（bun/node 内置优先）；TypeScript 严格类型（无 any）。
- **产出物**：`tools/<YYYY-MM-DD>-<slug>/`，含 `README.md`（是什么/解决什么/怎么跑/真实示例输出）+ 源码；必须真实运行验证一次，示例输出贴进 README；不得遗留常驻进程。
- 完成后在 `REGISTRY.md` 追加一行状态 `proposed`，等 kzf 裁决，不催促。

## 7. 价值判断学习闭环

当 kzf 对任何产出（工具提案、命名、架构、报告形态）表态时，agent 必须依次做：

1. 若是工具：`REGISTRY.md` 状态改为 `approved` / `rejected` / `iterated`。
2. `feedback-log.md` 追加：`日期 | 对象 | 裁决 | 理由（尽量原话） | 来源场景`。
3. 能提炼可复用判断 → `profile.md`「价值规则」追加（带日期与来源）；旧规则被推翻标 `superseded by <新规则>`，不删历史。
4. 否定 ≠ 删除产物目录：保留作反例上下文。

原则：具体理由 > 泛化结论；不确定为什么否定时，记录原话待下次蒸馏，不要臆测规则。

## 8. 自动化管道

- **每日 08:30 ZCode 定时任务**：抓取 → diff → 分类 → Graph → **生成昨天（T-1）的完整日报**（今天没过完不出今天的报告）→ 蒸馏裁决 → 工具工坊 → 发布到 gaubee.com。另有 **21:00 补漏任务**（幂等：当天主任务已完成则只刷新数据）。
- **手动运行**（脚本顺序即管道顺序）：

```sh
bun scripts/github-stars-fetch.ts                       # 星标全量快照
bun scripts/github-stars-diff.ts                        # 星标变更
bun scripts/github-commits-fetch.ts                     # 当日提交日志（含 compare 明细；可加 --date YYYY-MM-DD 回填，事件流仅覆盖近 ~2 周）
bun scripts/github-deps-fetch.ts                        # 依赖全扫 + 新技术首见事件（约 250 请求）
bun scripts/x-likes-fetch.ts                            # X 动态（posts/likes/bookmarks，browser 后端，增量；新条目自动下载图片/视频，--media-backfill N / --video-backfill N 补近期）
bun scripts/x-archive-import.ts <归档data目录>           # X Data Archive 历史回灌（一次性）
bun scripts/x-media-backfill.ts                         # 历史条目正文/媒体回灌（syndication 公开接口，免登录免 yt-dlp；幂等可续跑，--limit N 试跑；--max-gb 为 staging 本地盘护栏，默认 4.5）
bun scripts/tech-graph-build.ts                         # 技能 Graph
bun scripts/build-graph-page.ts                         # 技能 Graph 交互展示页
bun scripts/sync-site-graph.ts                          # 图谱 public 视图 → gaubee.com static/skill-graph/data.json（站点 osapp 数据源；私有仓剔除+发布断言；deps 扫描含 org 后必须跑）
# sync-site-graph 之后：data.json 有变化时在站点仓库单独提交推送（git add static/skill-graph/data.json 单文件，提交信息 📊 前缀；不与日报 event 混提交）
bun scripts/github-stars-categorize.ts --suggest        # 新星标分类建议
bun scripts/github-stars-categorize.ts --build-catalog  # 重建 catalog
bun scripts/build-report.ts --weekly|--monthly|--yearly [YYYY]
bun scripts/publish.ts <报告md> --slug <slug> --title <标题> --tags a,b   # 发布（先 --dry）
```

- **日报文体（2026-10-04 kzf 裁决）**：提交部分的核心是**每条工作流一句话总结"做了什么"**——必须读 changes 里的提交消息提炼（可跨仓库归组同一工作流），仓库与数字只作辅助信息，不得只罗列"N commits"。写作法则全文（蒸馏自 jixoai.com release-blog：changelog 风格、句级法则、修订门、AI-tell 查簇）见 `references/writing.md`；定稿前跑量化门禁 `node scripts/ai-tone-metrics.mjs`（lint reports/daily/*.md，RED 清零才放行；全绿仍需过 writing.md 的 R6 朗读）。
- **报式拆分（2026-10-05 kzf 裁决）：GitHub 事件做 GitHub 日报（`github-daily-<date>`，文件 `reports/daily/<date>.md`），X 事件做 X 日报（`x-daily-<date>`，文件 `reports/daily/<date>-x.md`），两者不混；周报/月报/年报只针对 GitHub 事件（build-report 本就不读 X）。**GitHub 日报内容：星标、提交、依赖、Graph、管道状态；X 日报内容：当日 X 动态条目化（下条格式）。X 历史动态另以 `x-archive-<date>` 归档 event 承载（生成器 `scripts/x-archive-events.ts`：按本地日合并、无动态日期自然跳过、策展日报已覆盖的日期跳过、正文 x-arch-* HTML 卡片、样式在 `src/lib/styles/x-archive.css`——**内容样式归属内容自身文件，禁止进全局 app.css**，谁渲染谁导入：ShoutView + article 页）。
- **X 动态条目化（2026-10-05 kzf 裁决；2026-10-07 cdn-media Phase 3 路径契约更新）**：X 日报逐条成块——`**@作者**：中文一句话点题（英文内容翻译，中文内容精炼不歪曲）＋[原推文](https://x.com/作者/status/id)＋本地媒体`。理由：墙内读者打不开 X 链接与嵌入 iframe，媒体必须转存自己域名（实测图片均值 163KB/张、720p 视频 3–12MB/条）。图片站内绝对路径 `/cdn-media/x/YYYY-MM/…` 逐张贴（R1 路径契约：**永不写 `/x-media/`，也永不绑定存储域名**），无媒体不贴；不全文转贴推文（引述 + 链接 + 署名）。视频三条路：①时间线 DOM 拿到直链（gif）直接下；②blob 播放器 → 抽取器标 `hasVideo`，yt-dlp 兜底（软依赖，720p 上限）；③历史回灌走 syndication 接口的 mp4 变体直链（免 yt-dlp）。视频卡片配封面（`x-posters.ts` 产 `posterLocal`，`<video poster=…>`）。
- **X 归档卡片规范（2026-10-05 kzf 裁决 5-15，x-archive-events.ts 落地）**：①作者头像走 syndication 外链（`x-avatars.ts` → authors.json，_bigger 档，不本地化）；②原推文/@作者/正文内链接一律 `target="_blank"`，正文 URL 正则自动包裹；③硬编码译文（`translations/x-tweets.zh.json`，渐进补充）默认显示译文，切换器收进卡片行头（CSS checkbox + `~` 选择器，零 JS）；④kind 徽标用有色 lucide SVG icon（赞❤/发✎/转🔁/藏🔖），不用文字；⑤列表全文客观渲染（prose 排版对齐详情），条目头 sticky；不做高度截断；⑥视频用 `x-video.ts` action 增强：自动播放、全局单实例、静音记忆（localStorage）、触屏手势（右纵滑音量/长按 2x/横滑进度/双击±10s/连击 (n-1)×10s 累计/单击播放暂停），桌面保留原生 controls；⑦代码块围栏转 `<pre data-language>`，microlighter（CSS Custom Highlights API）按需高亮，主题 `--syntax-*` 在 x-archive.css；⑧图片限宽高（多图 240px cover / 单图 contain 360px），点击走 photoswipe。
- **归档与隐私口径（2026-10-05 kzf 两次裁决）**：①私有**仓名可以写**进日报/公开内容——私有只是前期演进阶段的暂态，架构稳定后会开放；红线只在**代码与数据**（diff、内部文档、密钥、私有数据文件）绝不进公开渠道。②X 历史动态以 `x-archive-<date>` 归档 event 承载（生成器 `scripts/x-archive-events.ts`：按本地日合并、无动态日期自然跳过、策展日报已覆盖的日期跳过、正文 x-arch-* HTML 卡片）。③内容样式归属内容自身文件（`src/lib/styles/x-archive.css`），**禁止进全局 app.css**——每个应用自管样式，谁渲染谁导入（ShoutView + article 页）。
- **媒体管道（2026-10-07 cdn-media Phase 3 裁决）**：媒体**不进主仓 git**（R6 体积红线）——抓取落点 = `cdn-media/staging/x/YYYY-MM/`（canonical key 布局），`x.json` 的 `mediaLocal`/`videoLocal`/`posterLocal` 语义冻结为 canonical media key `cdn-media/x/YYYY-MM/<file>`（不再兼任磁盘路径）。发布链：`media-pack --patch`（staging → 补丁卷）→ `--publish`（GitHub Releases）→ manifest 指针换代（git commit）；staging 保留期 = 发布校验通过后 7 天清理。正文/日报引用一律 `/cdn-media/x/…`，由 static-server cdn-base 同源分发（兼容 302 `/x-media/*` 一个版本周期后移除）。cron 的媒体红线检查 = cdn-base 缓存水位 + 远端 Releases 用量（原 4.5GB 主仓红线作废；`--max-gb` 仅护 staging 本地盘）。
- **staging 清理协议（2026-10-07 r13 P1-3 收口）**：保留期唯一执行者 = `cdn-media/tools/staging-clean.ts`——默认 dry-run 只打印将删清单，`--execute` 才真删。删除四条件（全部满足）：①文件在当前 manifest 对象集内（复用 media-pack `loadCurrentState` 三态校验）②对象所在卷已发布（current.json 指针 asset_id ≥1 且 url 非空 = 发布收据）③文件 mtime 距今超 7 天 ④位于 staging/x/ 下；任何读取/解析失败 fail-closed 不删，删除后打印收据（删除数/释放字节/剩余 staging 字节）。执行节奏：**dry-run 先行**人工核对清单 → `--execute` 需人工确认，或由 cron 周任务执行（周任务先跑 `x-media-audit --require-packed` 确认零待打包，再跑清理）。验证：`bun test cdn-media/tools/staging-clean.test.ts`。
- **日报生成前置 gate（2026-10-07 r13 P1-2）**：X 日报生成前必须 `bun tools/2026-10-05-x-media-audit/x-media-audit.ts --require-packed` 退出 0 才放行——「引用已 stage 但未入卷」对站点即 404，不带旗标的诊断模式不拦截（仍退出 0）。
- **X 日报归窗规则（2026-10-09 kzf 裁决，方案 a）**：**liked/bookmarked 按「抓取差分」归窗**（本次 run 的 `changes/<运行日>.json` added = 上次抓取以来的赞，8:30 日更下恰是昨天的赞）；**posted/reposted 按 created_at 本地日窗**（行为时间=推文发布时间）。依据：X 不暴露点赞时刻，created_at 是推文发布时间（雪花 ID 可证），按它切 liked 窗会把「今天点的赞、赞昨天发的推文」错切进已发布的旧报告（10-08 实证丢失 2 条）。执行工具 = `tools/2026-10-09-x-window-entries/x-window-entries.ts --attribution auto --date <YESTERDAY>`（清单 + 媒体对账一体）。
- **X 历史回灌（2026-10-05）**：`x-media-backfill.ts` 走 `cdn.syndication.twimg.com/tweet-result`（公开 CDN，token 参数必填但值任意；429 退避 15s，礼貌限速 ~3.5 QPS）。正文 t.co 换真实链接、媒体占位链接剔除；全文优先（archive/browser DOM 截断版不倒灌）。幂等：条目处理过即标 `synChecked`；网络性失败不标记下次重试；推文删除计 `unavailable`。历史总量先 `--limit` 试跑再全量；staging 累计下载到 `--max-gb` 护栏即停下载只留元数据（本地盘护栏；媒体红线本体已改为 cdn-base 缓存水位 + 远端用量）。
- 失败必须如实报告错误并停止/降级，禁止伪造成功；报告数字必须来自脚本输出。
- 基线日分支：无上一份快照时 diff 输出 `BASELINE`——日报写「基线建立」，跳过对应插入。
- 完成定义（绿门）：声称「可用」的命令当日必须实跑 exit 0；未实跑的陈述不写。
- 脚本注释与字符串里禁止出现「星号+斜杠」序列（JSDoc 提前闭合事故，2026-10-03）。
- 脚本逻辑是事实源；发现 bug 当场修复（修完跑通验证），但不改变管道语义。
