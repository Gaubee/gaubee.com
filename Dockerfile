# ---------------------------------------------------------------------------
# gaubee.com 静态站镜像（备案合规：部署到国内服务器自有 Docker）。
#
# 三阶段：node 站点构建 → Rust 静态服务器编译 → scratch 运行时（~15MB 级）。
# 运行时为自研 Rust 静态服务（static-server/，axum + tower-http），
# 查找/缓存/MIME 语义与退役的 nginx 方案逐条对齐（见 static-server/src/main.rs 头注）。
#
# VITE_AUTH_BASE 三方一致性约束（见 AGENTS.md「部署架构」）：
#   默认生产值 https://auth.gaubee.com，与 worker/wrangler.toml WORKER_ORIGIN、
#   GitHub OAuth App callback 一致；如需变更必须三方同步，并在 build 时传参：
#   docker build --build-arg VITE_AUTH_BASE=https://xxx .
# ---------------------------------------------------------------------------

# ---- 阶段 1：构建静态站点产物 ----
FROM node:22-alpine AS site
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

# ---- 阶段 2：编译 Rust 静态服务器（alpine musl 静态链接）----
FROM rust:1-alpine AS server
WORKDIR /build
RUN apk add --no-cache musl-dev
# 依赖层单独缓存：仅 Cargo.toml/Cargo.lock 变更才触发依赖重编
COPY static-server/Cargo.toml static-server/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
  && cargo build --release \
  && rm -rf src target/release/deps/gaubee_static_server*
COPY static-server/src ./src
RUN touch src/main.rs && cargo build --release

# ---- 阶段 3：scratch 运行时（二进制 + 站点产物，无 shell/无基础库）----
FROM scratch
COPY --from=server /build/target/release/gaubee-static-server /server
COPY --from=site /app/build /srv

# 非 root 运行（scratch 无 /etc/passwd，用数字 UID/GID；8080 非 root 可绑）
USER 65532:65532
ENV SERVER_ROOT=/srv PORT=8080
EXPOSE 8080
ENTRYPOINT ["/server"]
