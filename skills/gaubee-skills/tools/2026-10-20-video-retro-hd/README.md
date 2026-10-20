# video-retro-hd — 存量低清视频追溯升级（重拉高清源 → 无损切 HLS → 改键 → 重渲染）

## 是什么

对 x.json 里 `videoLocal` 仍是单文件 `<id>-video.mp4`、且 media-meta 高度低于 `--max-h`（默认 720）的条目：

1. 经 `scripts/lib/x-video-dl.ts` 用 yt-dlp 新阶梯（1080p→720p→任意）重拉源到临时目录（`-N 8` 并发拉段、`.part` 续传、瞬时网络错误退避重试、拿到完整产物才迁出）；
2. ffprobe 对比：新高度 ≤ 旧高度 → 无增益丢弃，并记入 `retro-hd-nogain.json`（续跑不重拉）；
3. 有增益 → `scripts/lib/x-hls.ts` 无损切成 `<id>.m3u8 + <id>.segNNNN.ts` 进 `cdn-media/staging/x/<月>/`（段先落位、playlist 最后，与 media-pack 扫描并发安全）；逐条原子写回 x.json `videoLocal` 与 media-meta 新键；
4. 收集涉及的本地日，重渲染（`scripts/lib/x-rerender.ts`：日报覆盖日 `--force`、其余归档全量重写）；`--no-render` 时把日期记入 `retro-hd-pending-render.json`，之后 `--render-pending` 一次补齐。

## 解决什么

旧 720p 上限 + 190MB 单文件护栏让一批视频只存到 360p/480p（kzf 2026-10-20：「抓取的视频质量有点低」）。分片存储落地后单文件限制解除，本工具把存量追平：首跑候选 332 条。

设计上与 06:30 cron 共存：`--until HH:MM` 到点不再开新条目（给 cron 的「打包扫描 → 发布硬门」窗口让路，否则窗口内新落的 m3u8 会让 `--require-packed` 变红）；`--no-render` 让页面引用推迟到媒体入卷发布之后（R9：媒体可达才闭环，也避免 cron 预检撞上脏工作树），涉及日期**逐条**记入 pending（批次被 kill 也不丢）。

**限流退避（2026-10-21 实证）**：X 对被限流的 guest token 返回去掉媒体的降级推文，yt-dlp 报「No video could be found in this tweet」——首轮批次尾部连续 25 条全是它，单独复测每条都能拿到格式。限的是**发放节奏**不是具体推文：每个候选 spawn 一次 yt-dlp = 申请一枚 guest token，2s 间隔下一小时上百枚；二轮 8 分钟退避后仍连续失败，而同一时刻隔离单测（含已知有视频的金丝雀）全部正常，所以金丝雀判别不可靠。现行策略：条目间固定 15s 节流（含失败路径）；孤立失败当真没视频处理（不持久化、下次重试），连续 3 次即判限流暂停 15 分钟，3 轮仍限流则停批次把剩余留给下次。

## 怎么跑

```bash
bun tools/2026-10-20-video-retro-hd/video-retro-hd.ts --ids 2111176930812998035     # 单条
bun tools/2026-10-20-video-retro-hd/video-retro-hd.ts --limit 1 --no-render          # 冒烟
bun tools/2026-10-20-video-retro-hd/video-retro-hd.ts --until 05:00 --no-render      # 夜间全批（推荐）
bun tools/2026-10-20-video-retro-hd/video-retro-hd.ts --render-pending               # 媒体发布后补渲染
```

旗标：`--limit N` / `--ids a,b` / `--max-h 720` / `--no-render` / `--until HH:MM`（Asia/Shanghai 墙钟，须晚于当前时刻）/ `--render-pending`。
前置：yt-dlp、ffmpeg、ffprobe。产物在 staging，待 `media-pack --patch` 入卷；状态文件在私有数据目录 `~/.gaubee-skills/data/sources/x-likes/`（不进 git）。

## 真实示例输出（2026-10-20 → 21）

单条（47 分钟视频，原 360p 单文件 110MB——720p 源 235MB 早已超过 200MiB 卷硬限，正是分片要解决的场景）：

```
候选 1（videoLocal=mp4 且高度<720）
  升级 2111176930812998035：360p → 720p，472 段 235.4 MB

收据：升级 1｜无增益 0｜失败 0｜新增分片 235.4 MB｜涉及日期 1
  重渲染日报 2026-10-17（run-date 2026-10-18）：exit 0
  归档全量重写：exit 0（已覆盖日自动跳过）
```

同一条此前两次失败的教训都已固化进下载助手：第一次 `[SSL: UNEXPECTED_EOF_WHILE_READING]`（走代理拉 x.com GraphQL 约 1/3 概率抖动 → 瞬时错误退避重试）；第二次 10 分钟 spawn timeout 把下载杀在 105MB（→ 45 分钟预算 + `-N 8` + 续传，复跑从 105MB 续到 220MB 只用 1 分钟）。

冒烟与旗标：

```
候选 331（videoLocal=mp4 且高度<720），本次最多 1
  升级 2105558891488739655：694p → 1042p，5 段 1.5 MB

  到达截止 00:00，停止开新条目（剩余 330 条下次续跑）
收据：升级 0｜无增益 0｜失败 0｜截止顺延 330｜新增分片 0.0 MB｜涉及日期 0

待补渲染日期 1：2026-10-01
  归档全量重写（已覆盖日自动跳过）：exit 0
```

夜间全批（`--until 05:00 --no-render`，2026-10-21 00:1x 启动）首行：

```
候选 330（videoLocal=mp4 且高度<720，已排除无增益记录 0），截止 05:00
  无增益 2087930885060309202：源 622p ≤ 现有 622p
```

首轮在 01:3x 被手动停止（尾部连续 25 条「No video could be found」= 限流假象，由此加入上文的退避逻辑）：
升级 76｜无增益 149｜失败 69（67 条 No video + 2 条 SSL，全部不持久化、续跑重试）｜瞬时重试 70 次｜新增分片 1078 MB。
二轮 01:4x 以退避版续跑：`候选 105（…已排除无增益记录 149），截止 05:00`，首条即此前被判 No video 的 1789943536613286260 正常解析出视频。

完整收据见批次结束后的汇报；媒体由 06:30 cron 第 4 步入卷发布，之后由 cron 执行 `--render-pending`（SKILL.md 媒体管道节）让页面引用新键。
