# token-swap-apply — CDN token 更换一键应用

## 是什么
把「换 CDN token」固化成带验证的单一流程：①本地先验新 token（rate_limit 与
cdn-media 仓 manifest contents 双探针，不过就绝不碰服务器）→ ②服务器侧替换
compose 的 CDN_GITHUB_TOKEN 行（先带时间戳备份；token 经 ssh stdin 传入，不进
远端 argv、不落本地日志）→ ③`docker compose up -d gaubeeos` 重建并轮询 admin
stats 直到 manifest gen 追平本地指针 → ④公网抽验一条此前 404 的媒体 URL 出收据。
默认 dry-run（只做①并打印计划），`--execute` 才动服务器。

## 解决什么
2026-10-14 起 fine-grained PAT 失效，媒体交付慢性中断，换 token 的四步手工路径
（验证/改 compose/重启/验证）每步都可能错且无收据。token 到手当天即可用本工具
一条命令完成切换，ABORT 路径保证坏 token 永远进不了 compose。

## 怎么跑
```bash
CDN_TOKEN_NEW=<新token> bun tools/2026-10-16-token-swap-apply/token-swap-apply.ts            # dry-run：只验证
CDN_TOKEN_NEW=<新token> bun tools/2026-10-16-token-swap-apply/token-swap-apply.ts --execute  # 真正切换
```
退出码：0 = 成功（或 dry-run 验证通过）；1 = 验证失败/ABORT；2 = 用法异常。

## 真实示例输出（2026-10-16 实跑，坏 token 的 ABORT 路径）
```
本地探针 rate_limit：HTTP 401
本地探针 cdn-media manifest：HTTP 401
ABORT：新 token 未通过本地验证，服务器未被改动   （exit 1）
```
无 token 输入 → 用法提示（exit 2）。好 token 的 execute 路径待真实 token 到手后
首跑留档。
