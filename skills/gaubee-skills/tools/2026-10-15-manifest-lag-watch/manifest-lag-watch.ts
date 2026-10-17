// manifest-lag-watch.ts — 服务器交付滞后早警（工坊 2026-10-15 提案 1）
//
// 动机（2026-10-14 媒体 404 事故实证）：CDN token 失效后，服务器对远程 manifest
// 的刷新静默失败，靠本地缓存回退停在 gen-6，而线上已是 gen-8/9——「缓存回退 +
// 刷新失败」是慢性降级，直到新日报引用新对象才以 404 暴露。deploy-smoke 在公网侧
// 兜底，本工具在服务器侧更早报警：不需要等页面引用到不可见对象。
//
// 做什么：ssh 到服务器读 cdn-base admin stats 的 manifest gen，与本地 cdn-media
// 子仓 current.json 的 gen 对比；顺带做一次带 token 的 api.github.com 探针判定
// token 健康。滞后或 token 失效都给收据。只读，不在服务器留任何东西。
//
// 用法: bun tools/2026-10-15-manifest-lag-watch/manifest-lag-watch.ts [--ssh <host>]
// 默认 --ssh gaubee-cloud。退出码：0 = 同步且 token 健康；1 = 滞后/token 失效；2 = 用法异常。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function argOf(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const sshHost = argOf("--ssh", "gaubee-cloud");
const known = new Set(["--ssh"]);
const unknown = process.argv.slice(2).filter((a, i, arr) => !known.has(a) && arr[i - 1] !== "--ssh");
if (unknown.length > 0) {
  console.error(`用法: bun tools/2026-10-15-manifest-lag-watch/manifest-lag-watch.ts [--ssh <host>]（未知参数: ${unknown.join(" ")}）`);
  process.exit(2);
}

function sh(cmd: string, opts: { encoding?: string } = {}): { out: string; code: number } {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", ...opts });
  return { out: (r.stdout ?? "").trim(), code: r.status ?? 1 };
}

// 本地权威 gen：cdn-media 子仓 current.json（发布指针的本地副本）
const localCurrent = new URL("../../../../cdn-media/manifest/current.json", import.meta.url).pathname;
const local = JSON.parse(readFileSync(localCurrent, "utf8")) as { gen: number };
console.log(`本地指针 gen：${local.gen}`);

const stats = sh(
  `command ssh ${sshHost} "curl -s -m 10 http://127.0.0.1:8081/cdn-media-admin/stats"`,
);
if (stats.code !== 0 || !stats.out.startsWith("{")) {
  console.log(`FAIL 服务器 admin stats 不可达（${stats.out.slice(0, 80) || stats.code}）`);
  process.exit(1);
}
const remote = JSON.parse(stats.out) as { manifest: { gen: number; loaded: boolean } };
console.log(`服务器 manifest gen：${remote.manifest.gen}（loaded=${remote.manifest.loaded}）`);

let failed = 0;
if (remote.manifest.gen < local.gen) {
  failed++;
  console.log(`FAIL 滞后：服务器 gen-${remote.manifest.gen} 落后本地 gen-${local.gen}（gen-7 起的对象公网 404）`);
}
// token 健康：从服务器 compose 取 token（值不出服务器），对 cdn-media 仓做一次认证探针
// 注意：fine-grained PAT 后缀含下划线，字符类必须含 _（2026-10-17 实证：漏 _ 会截断
// token 使探针恒 401，把「指针镜像停更」误诊为「token 失效」）
const probe = sh(
  `command ssh ${sshHost} "TOKEN=\\$(grep -o 'github_pat_[A-Za-z0-9_]*' /opt/1panel/apps/local/gaubeeos/GaubeeOS/docker-compose.yml | head -1); curl -s -o /dev/null -m 10 -w '%{http_code}' -H \\"Authorization: Bearer \\$TOKEN\\" https://api.github.com/rate_limit"`,
);
console.log(`token 探针（rate_limit 认证）：HTTP ${probe.out}`);
if (probe.out.trim() !== "200") {
  failed++;
  console.log("FAIL token 失效或缺失——manifest 刷新与 release 回源都会失败（换新 token 并 up -d）");
}
console.log(failed === 0 ? "LAG WATCH OK：manifest 同步，token 健康" : `LAG WATCH FAIL：${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
