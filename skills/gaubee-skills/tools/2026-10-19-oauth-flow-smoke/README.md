# oauth-flow-smoke — 登录链路冒烟断言

## 是什么

对 auth.gaubee.com（自托管登录服务，2026-10-18 上线）的 GitHub OAuth 登录链路做五断言冒烟检查：健康自检、302 跳转 authorize、client_id 非空且非字面量 `undefined`、redirect_uri 为 https 回调地址、state cookie 带 HttpOnly。全过 exit 0，任一失败 exit 1。

## 解决什么

auth.gaubee.com 曾因 DNS 迁移静默失效两个月才被人肉发现（2026-08-15 起 OAuth 全局中断，会话未过期所以无感）。自托管上线后需要一条命令的回归门：cron 或部署后跑一次，域名级失效 / env 未注入（client_id=undefined，2026-10-18 实测出过的 bug）/ cookie 配置回退都能当场拦下。

## 怎么跑

```bash
bun tools/2026-10-19-oauth-flow-smoke/oauth-flow-smoke.ts                        # 默认线上
bun tools/2026-10-19-oauth-flow-smoke/oauth-flow-smoke.ts --base http://127.0.0.1:17090  # 打本地 auth-server
```

## 真实示例输出（2026-10-19）

线上（期望 PASS）：

```
  ok   健康自检 GET /｜status=200 name="gaubee-auth-server"
  ok   GET /auth/github 302 → authorize｜status=302 location=https://github.com/login/oauth/authorize?client_id=Ov23lilVqbaQBJTJWntw&redirect
  ok   client_id 非空且非字面量 undefined｜client_id=Ov23li…
  ok   redirect_uri 为 https 回调地址｜redirect_uri=https://auth.gaubee.com/auth/github/callback 期望=https://auth.gaubee.com/auth/github/callback
  ok   state cookie 存在且 HttpOnly｜set-cookie 含 gh_oauth_state；HttpOnly ✓

SMOKE PASS：5/5 断言全过（https://auth.gaubee.com）
exit=0
```

失败路径（--base https://example.com，期望 FAIL）：

```
  FAIL 健康自检 GET /｜status=200 name=""
  FAIL GET /auth/github 302 → authorize｜status=404 location=(空)
  FAIL GET /auth/github 302 → authorize｜网络失败：Invalid URL
  FAIL client_id 非空且非字面量 undefined｜网络失败：Invalid URL
  FAIL redirect_uri 为 https 回调地址｜网络失败：Invalid URL
  FAIL state cookie 存在且 HttpOnly｜网络失败：Invalid URL

SMOKE FAIL：6/6 断言未过
exit=1
```
