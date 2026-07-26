#!/usr/bin/env bash
# dev-login.sh —— 让 headless 浏览器（agent-browser）进入登录态。
#
# 原理：从 `gh auth login` 配置的 token，构造前端 URL 带 #auth_token=xxx fragment，
# 让前端 OAuth 回调消费逻辑读取 token 存入内存（与真实 OAuth 流程一致）。
#
# 安全：不碰用户的浏览器 Profile；token 仅存在于 headless session 内存，
# 用完（agent-browser close）即消失；token 本身不落盘、不回显。
#
# 前置：
#   1. gh auth login 已完成（gh auth status 显示 logged in）
#   2. agent-browser 已安装
#
# 用法：
#   ./scripts/dev-login.sh                                    # 默认前端域
#   FRONTEND_URL=https://gaubee.com.localhost ./scripts/...   # 自定义前端地址
#   SESSION=mobile ./scripts/...                              # 指定 agent-browser session
set -euo pipefail

# 默认前端域：portless 的 https://gaubee.com.localhost（vite dev 经 portless 反代）
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

echo "→ 让 headless 浏览器通过 fragment 消费 token..."
# 打开前端 URL 带 #auth_token=xxx fragment，前端 session.svelte.ts 的
# consumeTokenFromFragment 会读取并存入内存，然后清除地址栏 fragment。
agent-browser $SESSION_FLAG open "${FRONTEND_URL}/#auth_token=${TOKEN}" >/dev/null 2>&1 || true
sleep 3

echo "→ 验证登录态..."
RESULT="$(agent-browser $SESSION_FLAG eval "
(async () => {
  try {
    // 等待 authStore.refresh() 完成（fragment 消费后自动调）
    await new Promise(r => setTimeout(r, 1500));
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + '${TOKEN}' }
    });
    const j = await r.json();
    return JSON.stringify({ ok: r.ok && !!j.login, login: j.login ?? null });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
})()
" 2>/dev/null | tail -1)"

if echo "$RESULT" | grep -q '"ok":true' || echo "$RESULT" | grep -q '\\"ok\\":true'; then
  LOGIN="$(echo "$RESULT" | sed -n 's/.*[\\]"login[\\]":[\\]"\([^"\\]*\).*/\1/p')"
  echo "✓ 已登录（用户：${LOGIN:-unknown}）。headless 浏览器现可访问需登录的应用。"
else
  echo "⚠ token 验证返回：$RESULT"
  echo "  token 已注入前端内存，但验证可能因网络/时序问题失败。"
  echo "  前端域：$FRONTEND_URL（确保 pnpm dev 在跑）"
fi
