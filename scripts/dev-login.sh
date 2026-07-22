#!/usr/bin/env bash
# dev-login.sh —— 让 headless 浏览器（agent-browser）进入登录态。
#
# 原理：从 `gh auth login` 配置的 token，通过 agent-browser 的 CDP 注入到
# Cloudflare Worker 域下的 gh_token cookie（与 OAuth 流程设的同名 cookie）。
# Worker 的 getCookie 不校验 httpOnly 标志，所以普通 cookie 等同于登录态。
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
#   ./scripts/dev-login.sh                          # 默认 localhost:8787，默认 session
#   WORKER_URL=http://localhost:9999 ./scripts/...  # 自定义 Worker 地址
#   SESSION=mobile ./scripts/...                    # 指定 agent-browser session
set -euo pipefail

WORKER_URL="${WORKER_URL:-http://localhost:8787}"
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

echo "→ 注入 gh_token cookie 到 $WORKER_URL ..."
# 先确保 agent-browser 打开了 Worker 域（设 cookie 需要页面上下文）
agent-browser $SESSION_FLAG open "$WORKER_URL/" >/dev/null 2>&1 || true
sleep 1
agent-browser $SESSION_FLAG cookies set gh_token "$TOKEN" --url "$WORKER_URL" >/dev/null

echo "→ 验证登录态..."
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
  echo "✓ 已登录（用户：${LOGIN:-unknown}）。headless 浏览器现可访问需登录的应用。"
else
  echo "✗ 登录验证失败：$RESULT" >&2
  echo "  请确认 Worker 在 $WORKER_URL 运行（wrangler dev）" >&2
  exit 1
fi
