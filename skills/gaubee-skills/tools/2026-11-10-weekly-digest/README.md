# weekly-digest — 周报动笔前的跨源素材拼盘

## 是什么

按区间把三样东西聚合出来，直接当周报「分析」的草稿骨架：
1. 每个仓库的提交数与代表消息（跨 7 天的 history 合并，按仓库去重，最多 6 条示例）；
2. 每天新增星标，附 taxonomy 分类（按人工策展行匹配 repo 全名）；
3. X 动态按 kind 的每日计数。

零网络，只读本地 `~/.gaubee-skills/data`。

## 解决什么

周日写周报时，最耗时的一步是把七份日报里的提交重新捞一遍做主题聚类。`commits-digest` 只给单日，一个区间一个仓库动辄两三百条提交，手工翻很慢。周素材把「哪几个仓在动、动的是什么方向、星标落在哪些分类」一次摊开，分析仍由 agent 写。

## 怎么跑

```bash
bun tools/2026-11-10-weekly-digest/weekly-digest.ts                      # 默认上周（周一~周日）
bun tools/2026-11-10-weekly-digest/weekly-digest.ts --since 2026-11-02 --until 2026-11-08
bun tools/2026-11-10-weekly-digest/weekly-digest.ts --out /tmp/w45.md    # 落文件
```

退出码：0 = 有数据；1 = 区间无数据（history/changes 不全）；2 = 参数非法。

## 真实示例输出（2026-11-10，素材区间 11-02~11-08，节选）

```text
# 周素材 2026-11-02 ~ 2026-11-08

## 提交（按仓库）

### jixoai/fde2e-omni-v1（私有） — 250 条
- feat(web)!: AssetWorkbench 组件族统一——工作台素材库页签＝页面版套件…
- feat(web,server,adapter): RP 覆盖层升级——鼠标常显＋右覆改右侧＋键盘可视化九宫格…
- …另 168 条

### jixoai/fde2e-center（私有） — 173 条
- fix(ci): build-win 改走组织 win-ext 池原生 PowerShell 构建——不再 mac 交叉 NSIS
- fix(ci): Windows 打包前确保 Rosetta 2——Apple Silicon runner 执行 x64 makensis（EBADARCH 根修）
- …另 111 条

## 星标（按分类）
- **自托管、桌面与效率软件** 7：yetone/alma-relay（2026-11-03）、wquguru/cicada（2026-11-03）、wailsapp/wails（2026-11-03）、go-gitea/gitea（2026-11-03）、songloft-org/songloft（2026-11-04）、J3n5en/voicekey（2026-11-05）、yjid/kensaku（2026-11-07）
- **AI Agent 与编码助手** 4：vercel-labs/agent-desktop（2026-11-05）、huacnlee/noop（2026-11-05）、alibaba/qz-browser-agent（2026-11-06）、QingYunA/answer-me-with-html（2026-11-06）
- **样式、动效与可视化** 3：kubai087/kubai-icons（2026-11-03）、chunkithwang/design-playful-app-icons（2026-11-05）、DhvanilPatel/swarm-cursors（2026-11-05）

## X 动态（按 kind）
- 2026-11-04 posted 1
- 2026-11-04 liked 14
- 2026-11-05 liked 13
- 2026-11-06 liked 13
- 2026-11-07 liked 17
- 2026-11-07 bookmarked 1
…
```

## 判读建议

- 提交条数按仓库排，不代表重要性；私有仓消息是本地素材，写进公开日报前必须改写成不泄代码的人话。
- 星标分类来自 taxonomy 的人工策展行；`未分类` 表示 catalog 有它但策展还没放。
