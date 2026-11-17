#!/bin/sh
# server-daily-trigger.sh — 在服务器上做「6:00 前置抓取」的定时器（可选方案）
#
# 定位：服务器只当**可靠的定时器 + 日志看板**，真正的抓取仍在 Mac 上执行——
# 因为 gh 登录态、X 浏览器会话、私有数据根、cdn-media staging 都在 Mac，
# 服务器上没有这些凭据与数据（2026-11-17 实测：HK 机无 ~/.gaubee-skills、无 bun/node/gh）。
#
# 前置条件（缺一不可，未就绪时本脚本会干净地失败并留下日志）：
#   1. Mac → 服务器 有一条反向 SSH 隧道，把 Mac 的 22 端口映射到服务器某端口；
#      可在 Mac 的 frpc.toml 加：
#         [[proxies]]
#         name = "mac-ssh"
#         type = "tcp"
#         localIP = "127.0.0.1"
#         localPort = 22
#         remotePort = 13622      # 需在 frps 的 allow_ports 内
#      并在服务器的 sshd 侧无额外要求（隧道落在 127.0.0.1 即可）。
#   2. 服务器上有一条能免密登录 Mac 的密钥，且 Mac 的 ~/.ssh/authorized_keys 放行。
#   3. Mac 在该时段是醒着的（合盖会断；可在 Mac 上用 pmset 定时唤醒）。
#
# 安装（服务器，root 或 admin）：
#   install -m 755 server-daily-trigger.sh /usr/local/bin/gaubee-daily-trigger
#   (crontab -l 2>/dev/null; echo '0-25/5 6 * * * /usr/local/bin/gaubee-daily-trigger >> /var/log/gaubee-daily-trigger.log 2>&1') | crontab -
#
# 语义：6:00 起每 5 分钟试一次，最多到 6:25。已经跑过的那一轮在 Mac 侧是幂等的
#       （daily-auto 会跳过已完成步骤），所以重试是安全的。
set -u

MAC_HOST="${MAC_HOST:-kzf@127.0.0.1}"
MAC_PORT="${MAC_PORT:-13622}"
REMOTE_CMD='export PATH="$HOME/.vite-plus/bin:$HOME/.vite-plus/fallback-bin:$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:$PATH"; cd "$HOME/.agents/skills/gaubee-skills" && bun scripts/daily-auto.ts --stage fetch'

echo "[$(date '+%F %T')] trigger → ${MAC_HOST}:${MAC_PORT}"

if ! nc -z -w 5 127.0.0.1 "$MAC_PORT" 2>/dev/null; then
  echo "[$(date '+%F %T')] 隧道未就绪（127.0.0.1:${MAC_PORT} 不可达）；Mac 可能休眠或 frpc 未连"
  exit 1
fi

ssh -p "$MAC_PORT" -o ConnectTimeout=10 -o BatchMode=yes "$MAC_HOST" "$REMOTE_CMD"
code=$?
echo "[$(date '+%F %T')] 退出码 ${code}"
exit "$code"
