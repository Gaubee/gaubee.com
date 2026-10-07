#!/usr/bin/env bash
# preflight-kv-do.sh — geo KV→DO 对账 preflight（r13 P1-1 收口：Cloudflare API v4，fail-closed）
#
# 意图（正交意图清单）：
# - [2026-10-07 r13 P1-1] 原需求（plan A6 收口）：任何环境首次部署 GEO_RULES_DO 前，
#   必须实跑本脚本对账旧 KV 规则存量，发现 geo_rules_v1 key 即阻断部署并给出迁移路径。
#   旧内联版误用 gh api 访问 Cloudflare（gh 只打 GitHub API），且尾部 || true 把
#   404/认证失败吞成「无嫌疑」假 PASS——本版改为 CF API v4 直连，任何 API/认证/
#   网络/解析失败一律退出非零（fail-closed），绝不静默放行。
#
# 判定语义（冻结）：
#   PASS（exit 0）  ① 账户下无 geo/rules 嫌疑 namespace；
#                   ② 有嫌疑 namespace 但其 keys 里没有 geo_rules_v1（无规则数据可迁，
#                     建议顺手解绑/删除防误读，不阻断）。
#   阻断（exit 1）  ③ 嫌疑 namespace 存在 geo_rules_v1 key——必须先迁移再部署 DO。
#   阻断（exit 1）  ④ 任何 API/认证/网络/响应解析失败（fail-closed，含 env 缺失）。
#
# 环境变量：
#   CF_ACCOUNT_ID  必填，Cloudflare 账户 ID
#   CF_API_TOKEN   必填，Cloudflare API Token（需 Workers KV Storage:Read 权限）
#   CF_API_BASE    可选，API 根（缺省 https://api.cloudflare.com/client/v4）；
#                  夹具测试用本地 mock 覆盖（deploy/preflight-kv-do.mock.mjs），
#                  三路径自测见 deploy/cdn-base-rollout.md
#
# 依赖：curl、jq。依赖缺失按 fail-closed 退出非零。
#
# bash 3.2 兼容注意（macOS 自带 bash）：set -e 不会因「命令替换子壳退出非零」的赋值
# 而中止（实测 t1/t2 夹具）；因此本脚本不依赖 set -e 传播错误——cf_get/cf_get_all_pages
# 一律「写全局变量 + 显式 return 1」，每个调用点显式「|| fail」，fail 只在顶层直呼退出。

set -uo pipefail

CF_API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
CF_API_TOKEN="${CF_API_TOKEN:-}"
SUSPECT_RE='geo|rules'
KV_RULE_KEY='geo_rules_v1'
CF_BODY=""    # cf_get 的出口：最近一次成功响应 body
CF_LINES=""   # cf_get_all_pages 的出口：全部页 .result 逐项一行 JSON

log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "依赖缺失: curl 不在 PATH（fail-closed）"
command -v jq >/dev/null 2>&1 || fail "依赖缺失: jq 不在 PATH（fail-closed）"
[ -n "${CF_ACCOUNT_ID}" ] || fail "CF_ACCOUNT_ID 未设置（export CF_ACCOUNT_ID=<cloudflare 账户 id>）"
[ -n "${CF_API_TOKEN}" ] || fail "CF_API_TOKEN 未设置（export CF_API_TOKEN=<cloudflare api token>）"

# 单次 CF v4 GET：成功时写全局 CF_BODY 并 return 0；网络错误/HTTP 非 2xx/
# success!=true/非 JSON 一律打印 FAIL 并 return 1（由调用方 fail 兜底退出）。
cf_get() {
  CF_BODY=""
  local path="$1" tmp code body curl_status
  tmp="$(mktemp)" || { printf 'FAIL: mktemp 失败（fail-closed）\n' >&2; return 1; }
  code="$(curl -sS --connect-timeout 15 --max-time 60 \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -o "${tmp}" -w '%{http_code}' \
    "${CF_API_BASE}${path}")"
  curl_status=$?
  body="$(cat "${tmp}")"
  rm -f "${tmp}"
  if [ "${curl_status}" -ne 0 ]; then
    printf 'FAIL: 网络错误：GET %s（curl 退出码 %s，fail-closed）\n' "${path}" "${curl_status}" >&2
    return 1
  fi
  case "${code}" in
    2??) : ;;
    *)
      printf 'FAIL: GET %s HTTP %s（认证失败/权限不足/CF 侧错误，fail-closed）\n' "${path}" "${code}" >&2
      return 1
      ;;
  esac
  if ! printf '%s' "${body}" | jq -e '.success == true' >/dev/null 2>&1; then
    printf 'FAIL: GET %s 响应 success!=true 或非 JSON（fail-closed）：%.200s\n' "${path}" "${body}" >&2
    return 1
  fi
  CF_BODY="${body}"
  return 0
}

# 分页拉取 CF v4 列表端点：按 result_info.cursor 续页，全部 .result 逐项一行 JSON
# 写入全局 CF_LINES；任一页失败 return 1（调用方显式 || fail）。
cf_get_all_pages() {
  CF_LINES=""
  local base_path="$1" cursor="" page
  while :; do
    if [ -n "${cursor}" ]; then
      cf_get "${base_path}?per_page=100&cursor=${cursor}" || return 1
    else
      cf_get "${base_path}?per_page=100" || return 1
    fi
    page="$(printf '%s' "${CF_BODY}" | jq -c '.result[]?')" || return 1
    CF_LINES="${CF_LINES}${page}"$'\n'
    cursor="$(printf '%s' "${CF_BODY}" | jq -r '.result_info.cursor // ""')" || return 1
    [ -n "${cursor}" ] || break
  done
  return 0
}

log "== 1) 扫描 KV namespaces（CF API v4 分页；账户 ${CF_ACCOUNT_ID}）=="

cf_get_all_pages "/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces" \
  || fail "namespaces 列表拉取失败（API/认证/网络/解析，fail-closed）"

# 嫌疑投影："<id> <title>"（title 含 geo/rules 字样即嫌疑，大小写不敏感；缺 title 视为不匹配）
SUSPECTS="$(printf '%s\n' "${CF_LINES}" \
  | jq -r 'select((.title // "") | test("'"${SUSPECT_RE}"'"; "i")) | "\(.id) \(.title)"')" \
  || fail "namespaces 嫌疑投影失败（jq，fail-closed）"

if [ -z "${SUSPECTS}" ]; then
  log "PASS：账户下不存在 geo/rules 相关 KV namespace（与生产收据一致，无需迁移）"
  exit 0
fi

log "发现疑似旧 KV namespace："
log "${SUSPECTS}"
log ""

# 逐嫌疑 namespace 分页读 keys，找 geo_rules_v1
BLOCKERS=""
while read -r NS_ID NS_TITLE; do
  [ -z "${NS_ID}" ] && continue
  log "--- namespace ${NS_TITLE} (${NS_ID}) 的 keys ---"
  cf_get_all_pages "/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${NS_ID}/keys" \
    || fail "namespace ${NS_ID} keys 拉取失败（API/认证/网络/解析，fail-closed）"
  HAS_RULE_KEY=0
  while read -r KEY_LINE; do
    [ -z "${KEY_LINE}" ] && continue
    KEY_NAME="$(printf '%s' "${KEY_LINE}" | jq -r '.name // empty')" \
      || fail "namespace ${NS_ID} key 行解析失败（jq，fail-closed）"
    [ -z "${KEY_NAME}" ] && continue
    log "key: ${KEY_NAME}"
    if [ "${KEY_NAME}" = "${KV_RULE_KEY}" ]; then
      HAS_RULE_KEY=1
    fi
  done <<< "${CF_LINES}"
  if [ "${HAS_RULE_KEY}" -eq 1 ]; then
    BLOCKERS="${BLOCKERS}${NS_TITLE} (${NS_ID})"$'\n'
  fi
done <<< "${SUSPECTS}"

if [ -n "${BLOCKERS}" ]; then
  log ""
  log "FAIL：以下 namespace 存在 ${KV_RULE_KEY} 规则存量——首次 DO 部署阻断。"
  printf '%s' "${BLOCKERS}"
  log "迁移路径（人工执行，工具不自动迁移）：把上述每个 ${KV_RULE_KEY} 的 rules 经 owner PUT"
  log "逐条写入 DO（首写接受任意正整数版本，其后必须 current+1，见 rollout 文档第 3 节版本纪律；"
  log " 若 DO 已有规则且 KV 内容与之不一致，先人工裁决哪份权威，再决定是否 PUT）。"
  log "迁移完成、确认 KV 无规则数据后重跑本脚本，PASS 再继续 wrangler deploy。"
  exit 1
fi

log ""
log "PASS：嫌疑 namespace 均无 ${KV_RULE_KEY} 规则数据，无迁移需求，可继续 wrangler deploy。"
log "（建议顺手解绑/删除空嫌疑 namespace，防未来误读；不阻断本次部署。）"
