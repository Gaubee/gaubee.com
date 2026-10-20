# auth-server-deploy — auth-server 一键部署器

## 是什么

把 auth-server（自托管 GitHub OAuth 登录服务）的迭代部署收成一条命令：本地交叉编译 bun-linux-x64 单二进制 → scp 暂存 → 远端原子替换（旧版备份 .bak）→ systemctl restart → 健康断言（127.0.0.1:17090 返回含 "gaubee-auth-server" 的 JSON）→ 失败自动回滚并 exit 1。

## 解决什么

auth-server 2026-10-18 上线后迭代全靠手工五步（build/scp/mv/restart/ curl 验证），漏一步就静默带病。本工具把「部署 + 证据 + 回滚」固化，五阶段输出收据，健康不过自动回退旧版。

## 怎么跑

```bash
bun tools/2026-10-20-auth-server-deploy/auth-server-deploy.ts             # 完整部署
bun tools/2026-10-20-auth-server-deploy/auth-server-deploy.ts --dry-run   # 只构建+打印远端命令
bun tools/2026-10-20-auth-server-deploy/auth-server-deploy.ts --bad-health # 演练回滚路径
```

前置：本机 SSH 配置含 gaubee-cloud 主机；sudo -n 可用（远端 /opt 写权限）。

## 真实示例输出（2026-10-20）

回滚演练（--bad-health，验证失败路径）：

```
[2/5] scp 上传暂存 …
[3/5] 远端备份旧版 → 就位 → 重启 …
[4/5] 健康断言 …
      健康检查未过：(--bad-health 演练：判定失败)
[5/5] 回滚：恢复 .bak 并重启 …
FAIL 部署失败，已回滚（回滚后健康=true）
（真实 exit=1；回滚后远端 curl 返回 {"name":"gaubee-auth-server","ok":true}）
```

完整部署（无旗标）：

```
[1/5] 交叉编译 bun-linux-x64 …
      构建完成 /Users/kzf/Dev/Github/gaubee.com/auth-server/dist/gaubee-auth-linux-x64（86.7 MB）
[2/5] scp 上传暂存 …
[3/5] 远端备份旧版 → 就位 → 重启 …
[4/5] 健康断言 …
[5/5] 部署收据：86.7 MB → /opt/gaubee-auth/gaubee-auth；健康响应 {"name":"gaubee-auth-server","ok":true}
（真实 exit=0）
```
