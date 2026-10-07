// preflight-kv-do.mock.mjs — CF API v4 本地 mock（preflight-kv-do.sh 自测夹具）
//
// 用法：node deploy/preflight-kv-do.mock.mjs <mode>
//   empty           账户无任何 KV namespace                          → 脚本应 PASS（exit 0）
//   haskey          嫌疑 namespace 含 geo_rules_v1 key               → 脚本应阻断（exit 1）
//   nokey           嫌疑 namespace 存在但 keys 为空                  → 脚本应 PASS（exit 0）
//   paged           namespaces 两页分页（cursor 续页，第 2 页才有嫌疑）→ 脚本应 PASS（exit 0）
//   err             全端点 500                                       → 脚本应阻断（exit 非 0，fail-closed）
//   no-result       200 success=true 但缺 result 键（r14）           → 脚本应阻断（exit 1，且无 PASS 输出）
//   no-result-info  200 success=true 但缺 result_info 键（r14）      → 脚本应阻断（exit 1，且无 PASS 输出）
//   bad-cursor      200 但 result_info.cursor=123 非字符串（r14）    → 脚本应阻断（exit 1，且无 PASS 输出）
// 启动后 stdout 打印 "MOCK_PORT <port>"，SIGTERM/SIGINT 退出。
// 全部 id/title 均为假值，无真实凭据参与。

import http from "node:http";

const mode = process.argv[2] ?? "empty";
const PAGES = {
  1: [{ id: "fake_ns_page1", title: "assets-cache-dev" }],
  2: [{ id: "fake_ns_page2_suspect", title: "GEO_RULES-staging" }],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://mock.local");
  const send = (code, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };
  const ok = (result, cursor = "") =>
    send(200, { success: true, errors: [], messages: [], result, result_info: { page: 1, per_page: 100, count: result.length, total_count: result.length, cursor } });

  if (mode === "err") {
    return send(500, { success: false, errors: [{ code: 10000, message: "mock internal error" }] });
  }

  // r14 畸形成功响应夹具：结构校验前脚本必须不放行（空集假 PASS 防线）
  if (mode === "no-result") {
    return send(200, { success: true, errors: [], messages: [], result_info: { page: 1, per_page: 100, count: 0, total_count: 0, cursor: "" } });
  }
  if (mode === "no-result-info") {
    return send(200, { success: true, errors: [], messages: [], result: [] });
  }
  if (mode === "bad-cursor") {
    return send(200, { success: true, errors: [], messages: [], result: [], result_info: { page: 1, per_page: 100, count: 0, total_count: 0, cursor: 123 } });
  }

  if (url.pathname.endsWith("/storage/kv/namespaces")) {
    if (mode === "paged") {
      const cursor = url.searchParams.get("cursor") ?? "";
      const page = cursor === "" ? 1 : 2;
      return ok(PAGES[page] ?? [], page === 1 ? "cursor-to-page-2" : "");
    }
    if (mode === "empty") return ok([]);
    return ok([{ id: "fake_ns_suspect", title: "geo-rules-old-env" }]);
  }

  const keyMatch = /\/storage\/kv\/namespaces\/([^/]+)\/keys$/.exec(url.pathname);
  if (keyMatch) {
    const keys = mode === "haskey" ? [{ name: "geo_rules_v1" }] : [];
    return ok(keys);
  }

  return send(404, { success: false, errors: [{ code: 7000, message: `mock: no route ${url.pathname}` }] });
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`MOCK_PORT ${port} mode=${mode}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
