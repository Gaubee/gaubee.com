#!/usr/bin/env bash
# dev-login.sh —— 让 headless 浏览器（agent-browser）进入登录态。
#
# 原理：从 `gh auth login` 配置的 token，通过 agent-browser 的 CDP 注入 gh_token cookie。
#
# Cookie 注入策略（双域）：
# - Worker 域（localhost:8787）：直接 fetch Worker 时携带（生产同源/直连场景）。
# - 前端域（FRONTEND_URL）：前端经 vite proxy 同源访问 /auth/me、/api/proxy/* 时，
#   浏览器带前端域 cookie，proxy 透传给 Worker。portless 下前端域是 gaubee.com.localhost，
#   与 Worker 域跨站，SameSite=Lax 的 cookie 不跨站携带，故需前端域也注入。
#
# 安全：不碰用户的浏览器 Profile；token 仅存在于 headless session 内存，
# 用完（agent-browser close）即消失；token 本身不落盘、不回显。
#
# 前置：
#   1. gh auth login 已完成（gh auth status 显示 logged in）
#   2. Worker 在跑（wrangler dev，默认 http://localhost:8787）
#   3. agent-browser 已安装
#
# 用法：
#   ./scripts/dev-login.sh                                    # 默认双域注入
#   WORKER_URL=http://localhost:9999 ./scripts/...            # 自定义 Worker 地址
#   FRONTEND_URL=http://localhost:5173 ./scripts/...          # 自定义前端地址
#   SESSION=mobile ./scripts/...                              # 指定 agent-browser session
set -euo pipefail

WORKER_URL="${WORKER_URL:-http://localhost:8787}"
# 默认前端域：portless 的 https://gaubee.com.localhost（vite dev 经 portless 反代）
# portless 用内部 CA 证书支持 https，cookie 在 https 域下设置才能被同源请求携带。
FRONTEND_URL="${FRONTEND_URL:-https://gaubee.com.localhost}"
SESSION_FLAG=""
if [ -n "${SESSION:-}" ]; then
  SESSION_FLAG="--session $SESSION"
fi

echo "→ 检查 gh auth 登录状态..."
if ! gh auth status >/dev/null 2>&1; then
  echo "✗ 未登录。请先运行：gh auth login" >&2
  exit 1
fi

echo "→ 获取 token（不回显）..."
TOKEN="$(gh auth token)"
if [ -z "$TOKEN" ]; then
  echo "✗ 无法获取 token" >&2
  exit 1
fi

# 注入 cookie 到指定域（打开页面建立上下文后设 cookie）
inject_cookie() {
  local url="$1"
  echo "→ 注入 gh_token cookie 到 $url ..."
  agent-browser $SESSION_FLAG open "$url/" >/dev/null 2>&1 || true
  sleep 1
  agent-browser $SESSION_FLAG cookies set gh_token "$TOKEN" --url "$url" >/dev/null || true
}

# 双域注入：Worker 域（直连场景）+ 前端域（vite proxy 同源场景）
inject_cookie "$WORKER_URL"
inject_cookie "$FRONTEND_URL"

echo "→ 验证登录态（前端域经 vite proxy）..."
RESULT="$(agent-browser $SESSION_FLAG eval "
(async () => {
  try {
    // 经前端域同源访问 /auth/me（vite proxy 透传 cookie 到 Worker）
    const r = await fetch('$FRONTEND_URL/auth/me', { credentials: 'include' });
    const j = await r.json();
    return JSON.stringify({ ok: j.authenticated === true, login: j.user?.login ?? null });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
})()
" 2>/dev/null | tail -1)"

if echo "$RESULT" | grep -q '"ok":true' || echo "$RESULT" | grep -q '\\"ok\\":true'; then
  LOGIN="$(echo "$RESULT" | sed -n 's/.*[\\]"login[\\]":[\\]"\([^"\\]*\).*/\1/p')"
  echo "✓ 已登录（用户：${LOGIN:-unknown}）。headless 浏览器现可访问需登录的应用。"
else
  echo "⚠ 前端域验证失败，尝试 Worker 域直验..."
  RESULT="$(agent-browser $SESSION_FLAG eval "
(async () => {
  try {
    const r = await fetch('$WORKER_URL/auth/me', { credentials: 'include' });
    const j = await r.json();
    return JSON.stringify({ ok: j.authenticated === true, login: j.user?.login ?? null });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
})()
" 2>/dev/null | tail -1)"
  if echo "$RESULT" | grep -q '"ok":true' || echo "$RESULT" | grep -q '\\"ok\\":true'; then
    LOGIN="$(echo "$RESULT" | sed -n 's/.*[\\]"login[\\]":[\\]"\([^"\\]*\).*/\1/p')"
    echo "✓ 已登录（用户：${LOGIN:-unknown}，Worker 域直验）。headless 浏览器现可访问需登录的应用。"
  else
    echo "✗ 登录验证失败：$RESULT" >&2
    echo "  请确认 Worker 在 $WORKER_URL 运行（wrangler dev）" >&2
    echo "  且前端在 $FRONTEND_URL 运行（pnpm dev）" >&2
    exit 1
  fi
fi
