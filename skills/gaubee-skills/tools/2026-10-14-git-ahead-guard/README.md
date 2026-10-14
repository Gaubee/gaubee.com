# git-ahead-guard — 发布预检的「本地超前」守卫

## 是什么
对站点仓（gaubee.com）与 cdn-media 子仓各检查本地 main 是否领先 origin/main
（`git rev-list --count origin/main..main`），ahead > 0 即 FAIL 并列出待推提交。
只读：不 fetch 不 push（`--fetch` 可选先刷新远端引用）；离线可判——本地新提交
一定会计入，与最近一次 fetch 时点无关。

## 解决什么
2026-10-13 实证：cron 产物提交 aaa55d49f 忘了 push，publish.ts 的预检只查
「落后远端」不查「本地超前」——产物搭着下一次发布的提交才上去，期间单独触发的
CI 构建不含这些内容，部署状态与本地认知错位一整个发布周期。

## 怎么跑
```bash
bun tools/2026-10-14-git-ahead-guard/git-ahead-guard.ts [--fetch]
```
建议位置：cron 第 10 步发布之前（PREFLIGHT 之前跑）。退出码：0 = 两侧仓无本地
超前；1 = 有未推提交；2 = 用法/引用异常。

## 真实示例输出（2026-10-14 实跑）
```
PASS gaubee.com（ahead 0 / behind 0）
PASS cdn-media（ahead 0 / behind 0）
GUARD OK：无本地超前，可安全发布
```
