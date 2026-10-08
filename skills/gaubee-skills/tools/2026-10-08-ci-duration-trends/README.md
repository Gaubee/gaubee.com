# ci-duration-trends

## 是什么

GitHub Actions 耗时趋势速览：把 `gh run list` 的原始流水按 workflow 分组，给出
均值/最快/最慢、近 5 次相对更早的趋势方向，以及单次最耗时 top5。只读，不触发任何
远端操作。

## 解决什么

kzf 关注 CI 耗时（点赞过「gh 并行 jobs 免费提速 2×」信号），日常守着 gaubee.com 的
Docker 构建；原始 run 列表回答不了「最近有没有变慢、最慢的一次是哪个提交」。本工具
一条命令给出结论。首次实跑即验证了媒体摘除的收益：Docker 构建均值从 13m41s 降到
2m49s（-79%）。

## 怎么跑

```sh
bun ~/.agents/skills/gaubee-skills/tools/2026-10-08-ci-duration-trends/ci-duration-trends.ts \
  [--repo OWNER/REPO] [--limit N]      # 默认 Gaubee/gaubee.com，最近 30 次
```

前置：`gh auth login` 已登录且对目标仓库可读。耗时 = updatedAt − startedAt（gh 未给
startedAt 时退回 createdAt，含排队时间；趋势比较内部一致）。

## 真实示例输出（2026-10-08 实跑 Gaubee/gaubee.com）

```
ci-duration-trends：Gaubee/gaubee.com（最近 30 次，完成 30 次）

按 workflow 分组（耗时=运行窗口，含排队）：
  Build and Push Docker Image：23 次，均值 11m19s，最快 10s，最慢 32m34s；趋势 变快 79%（近5次 2m49s vs 更早 13m41s）
  Deploy Auth Worker to Cloudflare：7 次，均值 1m5s，最快 1m0s，最慢 1m11s；趋势 变慢 3%（近5次 1m5s vs 更早 1m4s）

单次最耗时 top5：
  32m34s  Build and Push Docker Image  #37561771328  🐛 Phase 1 r6 修复落地：tee 流生命周期锁（FlightGuard 随流持有）…
  27m9s   Build and Push Docker Image  #37575490699  🐛 worker 测试 CI 修复：oxc.tsconfig 钉住 worker/tsconfig.json…
  26m18s  Build and Push Docker Image  #37566850749  🧩 cdn-media gitlink：r7 修复（工具 fail-closed 收口）
  26m16s  Build and Push Docker Image  #37581800243  ✅ json-viewer 历史测试适配 IndexedDB（合并 main 后回归修复）
  26m1s   Build and Push Docker Image  #37578421072  🔧 r9-P1-1 守卫修复正式入库：整行锚定正则（含 fixture 自检步）…
```

退出码：成功 0；gh 未登录/调用失败 1；用法错误 2。
