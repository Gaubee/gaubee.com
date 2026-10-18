# auth-server —— gaubee.com 登录/上传自托管服务

Cloudflare Worker（`worker/`）中除头像反代外的全部职责的自托管实现。
**2026-10-18 kzf 裁决**：登录/上传迁国内服务器（gaubee-cloud），不再依赖 CF；
头像反代留守 CF（自定义域 `twimg.tweb.xin`，源站不可达 pbs.twimg.com 实证）。

## 迁移动机与背景

gaubee.com zone 2026-08-15 迁往阿里云 DNS 后，CF 侧 `auth.gaubee.com`
Custom Domain 失效（边缘无证书，全球 TLS alert 40），OAuth 登录中断。
自托管后 `auth.gaubee.com` 由本服务在源站应答（openresty 终结 TLS 反代），
**域名不变** ⇒ GitHub OAuth App 回调、前端 `VITE_AUTH_BASE`、
worker/wrangler.toml 三方一致性清单全部零改动。

## 路由（与 CF Worker 逐条对齐）

| 路由 | 语义 | 存储差异 |
|------|------|----------|
| `GET /` | 健康自检 | — |
| `GET /auth/github` | OAuth 发起（state cookie 防 CSRF） | — |
| `GET /auth/github/callback` | code 换 token，fragment 回前端 | — |
| `POST /upload/image` | GitHub Contents API 插图上传 | — |
| `/api/geo`、`/api/geo/rules` | 地区媒体路由 | CF 版存 Durable Object；本服务存 JSON 文件（CAS 语义对齐，见 `src/geo-store.ts`） |
| `GET /twimg/*` | 302 → `twimg.tweb.xin`（存量链接兼容；白名单外 404） | CF 版做真实反代 + Cache API |

访客地理：CF 版取 `request.cf.country`；源站版暂无 geoip，`geoOf()` 返回
undefined → 落规则默认分支（接入点已收敛在 `geo-routes.ts#geoOf`）。

## 出口依赖（部署前已实测 gaubee-cloud 可达）

- `github.com/login/oauth/access_token`（OAuth 换 token）
- `api.github.com`（upload Contents API、owner 身份校验）
- pbs.twimg.com **不需要**（头像在 CF）

## 部署 runbook（gaubee-cloud）

```bash
# 1. 本地构建（交叉编译，服务器无需装运行时）
cd auth-server && bun install && bun run build
#    → dist/gaubee-auth-linux-x64（单文件二进制）

# 2. 上传（二进制 + 环境变量文件 + systemd unit）
scp dist/gaubee-auth-linux-x64 gaubee-cloud:/tmp/gaubee-auth
scp deploy/gaubee-auth.service gaubee-cloud:/tmp/

# 3. 服务器侧（.env 含 GITHUB_CLIENT_SECRET，600 权限，不进 git）
sudo mkdir -p /opt/gaubee-auth/data
sudo mv /tmp/gaubee-auth /opt/gaubee-auth/gaubee-auth && sudo chmod +x $_
#    写 /opt/gaubee-auth/.env：
#      APP_ORIGIN=https://gaubee.com
#      WORKER_ORIGIN=https://auth.gaubee.com
#      ENVIRONMENT=production
#      OWNER_LOGIN=gaubee
#      GITHUB_CLIENT_ID=...  GITHUB_CLIENT_SECRET=...
#      GEO_RULES_PATH=/opt/gaubee-auth/data/geo-rules.json
#      PORT=17090
sudo mv /tmp/gaubee-auth.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gaubee-auth

# 4. openresty vhost（复用 *.gaubee.com 泛域证书，无需新签）
sudo cp deploy/auth.gaubee.com.conf（仓库内模板） /opt/1panel/apps/openresty/openresty/conf/conf.d/
sudo /usr/local/openresty/nginx/sbin/nginx -t && sudo nginx -s reload   # 路径以服务器实际为准

# 5. DNS 生效前预验证（无需改 DNS 即可全链路演练）
curl --resolve auth.gaubee.com:443:39.107.213.167 https://auth.gaubee.com/

# 6. kzf 在阿里云 DNS 控制台：auth 记录 CNAME(workers.dev) → A 39.107.213.167
# 7. geo 规则种子：从 CF DO 导出当前规则写入 /opt/gaubee-auth/data/geo-rules.json
```

## 回滚

阿里云 DNS 把 auth 改回原记录（或任何指向），源站服务与 vhost 可原样保留（无流量即无副作用）；
`systemctl disable --now gaubee-auth` 彻底下线。CF Worker 未删除，可随时改回。

## 已知边界

- 服务器到 github.com 为「间歇可达」级（历史观察），OAuth 换 token 单次短请求，
  劣化时用户表现为登录偶发失败重试即可；cf 侧无此前缀问题但域名已死，两害取其轻。
- `/api/geo` 的地区判定暂为默认分支（无 geoip）；接入 geoip2 后 geoOf() 一处扩展。
- 本服务不进站点 Docker 镜像（scratch 镜像保持纯净）；CI 自动化构建二进制为后续事项。
