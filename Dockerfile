# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# gaubee.com 静态站镜像（备案合规：部署到国内服务器自有 Docker）。
#
# 构建链与 CI（.github/workflows/main.yml）保持一致：
#   pnpm install --frozen-lockfile → pnpm build（content:prepare + vite build）
#   → adapter-static 输出 build/（SPA fallback=index.html + /pages SSG）
# → nginx:alpine 托管。
#
# VITE_AUTH_BASE 三方一致性约束（见 AGENTS.md「部署架构」）：
#   默认生产值 https://auth.gaubee.com，与 worker/wrangler.toml WORKER_ORIGIN、
#   GitHub OAuth App callback 一致；如需变更必须三方同步，并在 build 时传参：
#   docker build --build-arg VITE_AUTH_BASE=https://xxx .
# ---------------------------------------------------------------------------

# ---- 阶段 1：构建静态产物 ----
FROM node:22-alpine AS build
WORKDIR /app

# pnpm@10.22.0：与本地开发环境对齐（更新的 10.x 会因 onlyBuiltDependencies
# 与 --config.dangerouslyAllowAllBuilds 的注入产生 ERR_PNPM_CONFIG_CONFLICT）
RUN npm install -g pnpm@10.22.0

# 先拷贝依赖清单，最大化 layer 缓存命中
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# 不带 --config.dangerouslyAllowAllBuilds：pnpm-workspace.yaml 的
# onlyBuiltDependencies 白名单（esbuild + @tailwindcss/oxide）已覆盖所需构建脚本，
# 且该 flag 与显式白名单在 pnpm 10.22 互斥（ERR_PNPM_CONFIG_CONFLICT_BUILT_DEPENDENCIES）
RUN pnpm install --frozen-lockfile

# VITE_AUTH_BASE：构建期注入前端的 OAuth 跳转目标（非敏感，仅域名）
ARG VITE_AUTH_BASE=https://auth.gaubee.com

COPY . .
RUN <<'EOS'
  set -eu
  # 防回退校验（与 CI 同逻辑）：必须是 https:// 开头，避免 localhost 静默上线
  case "$VITE_AUTH_BASE" in
    https://*) ;;
    *) echo "::error::VITE_AUTH_BASE 必须是 https:// 开头（当前：'$VITE_AUTH_BASE'）" >&2; exit 1 ;;
  esac
  pnpm build
EOS

# ---- 阶段 2：nginx 托管 ----
FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
