#!/usr/bin/env bash
# preflight-kv-do.selftest.sh — preflight-kv-do.sh 九路径自测 runner（本地夹具，零真实凭据）
#
# 每个夹具模式起一次 deploy/preflight-kv-do.mock.mjs，跑完立即 kill+wait 回收；
# 断言：退出码符合预期；PASS 模式输出含 PASS 判定行（「PASS：」带全角冒号）；阻断模式
# 输出不得含 PASS 判定行——r14 收口要求：畸形成功响应必须 exit 1 且不出现假 PASS 判定。
# 注意阻断文案的迁移指引里有一句「PASS 再继续 wrangler deploy」，无冒号，不算判定行。
# 最后统一 pgrep 复查无 mock 残留。
#
# 用法：bash deploy/preflight-kv-do.selftest.sh   # 在仓库根或任意目录均可
# 依赖：node、jq、curl（preflight 本体已要求后两者）

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/preflight-kv-do.sh"
MOCK="${HERE}/preflight-kv-do.mock.mjs"

PASS_CASES="empty nokey paged"
BLOCK_CASES="haskey err no-result no-result-info bad-cursor"
fail_count=0

bash -n "${SCRIPT}" || { echo "FAIL: 语法检查未过"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL: node 不在 PATH"; exit 1; }

for mode in ${PASS_CASES} ${BLOCK_CASES}; do
  port_file="$(mktemp)"
  node "${MOCK}" "${mode}" > "${port_file}" 2>&1 &
  mock_pid=$!
  port=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.2
    port="$(sed -n 's/^MOCK_PORT \([0-9][0-9]*\).*/\1/p' "${port_file}" | head -1)"
    [ -n "${port}" ] && break
  done
  if [ -z "${port}" ]; then
    echo "FAIL: [${mode}] mock 未就绪"; cat "${port_file}"; rm -f "${port_file}"
    kill "${mock_pid}" 2>/dev/null; wait "${mock_pid}" 2>/dev/null
    fail_count=$((fail_count + 1))
    continue
  fi
  output="$(CF_API_BASE="http://127.0.0.1:${port}" CF_ACCOUNT_ID=fake-account-id CF_API_TOKEN=fake-token \
    bash "${SCRIPT}" 2>&1)"
  rc=$?
  kill "${mock_pid}" 2>/dev/null
  wait "${mock_pid}" 2>/dev/null
  rm -f "${port_file}"

  case " ${PASS_CASES} " in
    *" ${mode} "*)
      if [ "${rc}" -eq 0 ] && printf '%s' "${output}" | grep -q 'PASS：'; then
        echo "ok   [${mode}] exit=0 含 PASS"
      else
        echo "FAIL [${mode}] 期望 PASS exit 0，实得 exit=${rc}"; printf '%s\n' "${output}" | tail -3
        fail_count=$((fail_count + 1))
      fi
      ;;
    *)
      if [ "${rc}" -ne 0 ] && ! printf '%s' "${output}" | grep -q 'PASS：'; then
        echo "ok   [${mode}] exit=${rc} 无 PASS"
      else
        echo "FAIL [${mode}] 期望阻断 exit!=0 且无 PASS，实得 exit=${rc}"; printf '%s\n' "${output}" | tail -3
        fail_count=$((fail_count + 1))
      fi
      ;;
  esac
done

# 无 token 路径：不起 mock，脚本应在 env 检查处 fail-closed
output="$(env -u CF_API_TOKEN CF_ACCOUNT_ID=fake-account-id bash "${SCRIPT}" 2>&1)"
rc=$?
if [ "${rc}" -ne 0 ]; then
  echo "ok   [无 CF_API_TOKEN] exit=${rc} 无 mock"
else
  echo "FAIL [无 CF_API_TOKEN] 期望阻断，实得 exit=0"; fail_count=$((fail_count + 1))
fi

# 残留复查：九个夹具每个都 kill+wait 过，仍再兜底扫一次
if pgrep -fl "preflight-kv-do.mock.mjs" >/dev/null 2>&1; then
  echo "FAIL: mock 进程残留"; pgrep -fl "preflight-kv-do.mock.mjs"
  fail_count=$((fail_count + 1))
else
  echo "ok   无 mock 进程残留"
fi

if [ "${fail_count}" -eq 0 ]; then
  echo "SELFTEST PASS：10/10（9 夹具 + 无 token）"
  exit 0
fi
echo "SELFTEST FAIL：${fail_count} 项不符合预期"
exit 1
