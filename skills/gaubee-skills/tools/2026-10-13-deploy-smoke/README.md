# deploy-smoke — 发布后公网冒烟

## 是什么
从公网侧对站点仓库 `src/content/events` 最新 N 篇 event 的详情页逐个 GET，断言四件事：
HTTP 200、非 SPA 壳（字节数 > 5000B 基线）、非「请求拦截」页（WAF 拦截特征）、
title 含 stem 或 frontmatter 标题。只读；零第三方依赖（内建 fetch）。

## 解决什么
2026-10-13 WAF 事故实证：CI 绿 + watchtower 重建 ≠ 站点可达——1Panel WAF 的
defaultUrlBlack 规则中裸 `\.git` 子串命中 `.github-daily`，全部 GitHub 日报详情页
对公网 403「请求拦截」，而镜像、容器、页面文件全绿（容器侧取证完全不可见）。
本工具把「从公网真的能读到」变成发布流程的可断言项； cron 第 10 步发布、
CI+watchtower 收敛（约 10 分钟）后跑一次即可抓此类回归。注意：本地已写未发布的
event 会 FAIL（属预期），应在发布并部署收敛后运行。

## 怎么跑
```bash
bun tools/2026-10-13-deploy-smoke/deploy-smoke.ts [--n 8] [--base https://gaubee.com]
```
退出码：0 = 全过；1 = 有失败项（可作 cron 门禁）。

## 真实示例输出（2026-10-13 实跑，WAF 修复后）
```
PASS 01818.github-daily-2026-10-09（16195B）
PASS 01821.x-daily-2026-10-09（126784B）
PASS 01822.x-daily-2026-10-10（122991B）
PASS 01823.github-daily-2026-10-10（18522B）
PASS 01824.x-daily-2026-10-11（86545B）
PASS 01825.github-daily-2026-10-11（13841B）
PASS 01826.signals-weekly-W41（130532B）
FAIL 01827.x-archive-2026-10-12 → 疑似 SPA 壳（4190B）…（当日未发布，属预期）
SMOKE FAIL：1/8 不过
```
首跑（修复前）曾准确抓出 01823/01825 的 WAF 拦截与壳页问题。
