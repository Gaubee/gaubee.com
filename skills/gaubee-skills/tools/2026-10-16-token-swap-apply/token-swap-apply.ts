// token-swap-apply.ts — CDN token 更换一键应用（工坊 2026-10-16 提案 1）
//
// 背景：2026-10-14 实证 fine-grained PAT 过期导致媒体交付慢性失效（服务器 manifest
// 停在旧 gen，新对象公网 404）。换 token 的手工路径有四步（本地验新、改服务器
// compose、重启容器、验证 gen 追平与媒体 200），每步都可能错。本工具把它固化成
// 带验证的单一流程：
//   1. 本地先验新 token：/rate_limit 200 且 cdn-media 仓 manifest contents 200
//      （不通过就绝不碰服务器——防把坏 token 写进 compose）
//   2. 服务器侧替换 compose 的 CDN_GITHUB_TOKEN 行（先备份；token 经 ssh stdin
//      传入，不进远端 argv/不落本地日志）
//   3. docker compose up -d 重建 gaubeeos，轮询 admin stats 直到 gen 追平本地指针
//   4. 公网抽验一条此前 404 的媒体 URL，输出收据
// 默认 dry-run（只做 1 并打印计划）；--execute 才动服务器。
// 新 token 来源：环境变量 CDN_TOKEN_NEW（推荐）或 --token（不推荐，会进 shell 历史）。
//
// 用法: CDN_TOKEN_NEW=xxx bun tools/2026-10-16-token-swap-apply/token-swap-apply.ts [--execute] [--ssh <host>]
// 退出码：0 = 全流程成功（或 dry-run 验证通过）；1 = 任一验证失败；2 = 用法异常。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const sshHost = argOf("--ssh") ?? "gaubee-cloud";
const execute = process.argv.includes("--execute");
const token = process.env.CDN_TOKEN_NEW ?? argOf("--token") ?? "";
if (!/^github_pat_|^ghp_|^gho_/.test(token)) {
  console.error("用法: CDN_TOKEN_NEW=<新token> bun tools/2026-10-16-token-swap-apply/token-swap-apply.ts [--execute] [--ssh <host>]");
  process.exit(2);
}

function sh(cmd: string, input?: string): { out: string; code: number } {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", input });
  return { out: (r.stdout ?? "").trim(), code: r.status ?? 1 };
}
function ssh(cmd: string, input?: string): { out: string; code: number } {
  // 远端命令单引号包裹：$/?、; 等留给远端 shell（cmd 内不得含单引号）
  return sh(`command ssh ${sshHost} '${cmd}'`, input);
}

// 1. 本地验证新 token（fake / real 检查点都不打 token）
const p1 = sh(
  `curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Authorization: Bearer ${token}" https://api.github.com/rate_limit`,
);
console.log(`本地探针 rate_limit：HTTP ${p1.out}`);
const p2 = sh(
  `curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/Gaubee/cdn-media.gaubee.com/contents/manifest/current.json?ref=main"`,
);
console.log(`本地探针 cdn-media manifest：HTTP ${p2.out}`);
if (p1.out !== "200" || p2.out !== "200") {
  console.log("ABORT：新 token 未通过本地验证，服务器未被改动");
  process.exit(1);
}
// 本地指针 gen（验证目标）
const localGen = (JSON.parse(readFileSync(new URL("../../../../cdn-media/manifest/current.json", import.meta.url).pathname, "utf8")) as { gen: number }).gen;
console.log(`本地指针 gen：${localGen}`);

if (!execute) {
  console.log("dry-run：验证通过。加 --execute 执行服务器侧替换与重启");
  process.exit(0);
}

// 2. 服务器侧替换：先传远端脚本（无 token），再单独喂 token 到其 stdin——
//    两步各自单层引号，杜绝多层转义；token 不进远端 argv、不落本地日志
const COMPOSE = "/opt/1panel/apps/local/gaubeeos/GaubeeOS/docker-compose.yml";
const SWAP_SCRIPT = `import sys, re, shutil, datetime
p = "/opt/1panel/apps/local/gaubeeos/GaubeeOS/docker-compose.yml"
s = open(p).read()
t = sys.stdin.read().strip()
if not t:
    sys.exit("empty token on stdin")
bak = p + ".bak-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(p, bak)
n = re.sub(r"CDN_GITHUB_TOKEN: *\\S+", "CDN_GITHUB_TOKEN: " + t, s)
if n == s:
    sys.exit("old token line not found in compose")
open(p, "w").write(n)
print("compose updated (backup: %s)" % bak)`;
const up1 = ssh(`cat > /tmp/gaubee-tokenswap.py`, SWAP_SCRIPT);
if (up1.code !== 0) {
  console.log(`ABORT：脚本上传失败`);
  process.exit(1);
}
const swap = ssh(`sudo -n python3 /tmp/gaubee-tokenswap.py; rc=$?; rm -f /tmp/gaubee-tokenswap.py; exit $rc`, token);
console.log(swap.out || `（远端无输出，exit ${swap.code}）`);
if (swap.code !== 0) {
  console.log(`ABORT：替换失败`);
  process.exit(1);
}

// 3. 重建容器并轮询 gen 追平
const up = ssh(`cd ${COMPOSE.replace(/[^/]*$/, "")} && docker compose up -d gaubeeos 2>&1 | tail -1`);
console.log(`up -d：${up.out}`);
let gen = 0;
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const st = ssh("curl -s -m 5 http://127.0.0.1:8081/cdn-media-admin/stats");
  try {
    gen = (JSON.parse(st.out) as { manifest: { gen: number } }).manifest.gen;
  } catch {
    continue;
  }
  console.log(`  poll ${i + 1}: gen=${gen}`);
  if (gen >= localGen) break;
}

// 4. 收据
const probe = ssh(
  `curl -s --http1.1 -o /dev/null -m 20 -w '%{http_code}' https://gaubee.com/cdn-media/x/2026-10/2108557062359941589-video.mp4`,
);
console.log(`媒体抽验（此前 404 的对象）：HTTP ${probe.out}`);
const ok = gen >= localGen && probe.out === "200";
console.log(ok ? `SWAP OK：gen=${gen}，媒体恢复交付` : "SWAP INCOMPLETE：见上方各项（可能需再等刷新周期）");
process.exit(ok ? 0 : 1);
