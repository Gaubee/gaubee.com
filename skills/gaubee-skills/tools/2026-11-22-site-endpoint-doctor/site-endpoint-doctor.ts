#!/usr/bin/env bun
/**
 * site-endpoint-doctor — 站点入口体检（DNS / 直连 / 证书 / 边缘与源站是否一致）
 *
 * 背景（2026-11-22 实证）：gaubee.com 一周内换过两次地址（北京 → 香港 → 新入口 118.26.39.57）。
 * 工具里写死的旧 IP 让 HLS、部署冒烟、页面探针连续三天报「404 / TLS 不可达」，
 * 看起来像站点挂了，实际只是钉子钉在了旧地址。人查这件事的第一步也只能是
 * 「DNS 现在指哪、这个 IP 通不通、证书是谁签的、边缘和源站内容一不一致」。
 *
 * 本工具把这几件一次做完：
 *   1. DoH 解析当前 A 记录（本机 DNS 走 clash fake-ip，系统解析不可信）
 *   2. 直连该 IP 的 80 / 443 是否可达
 *   3. TLS 证书的 subject / issuer / 到期时间
 *   4. 首页与最新 event 页的状态与字节数
 *   5. 边缘 vs 源站（可选 --ssh <host>）：同一条路径两边返回是否一致
 *
 * 用法：
 *   bun tools/2026-11-22-site-endpoint-doctor/site-endpoint-doctor.ts
 *   bun tools/2026-11-22-site-endpoint-doctor/site-endpoint-doctor.ts --ssh gaubee-cloud
 * 退出码：0 = 入口可用；1 = 有硬问题（直连不通 / 证书过期 / 页面异常）；2 = 参数异常。
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");

function sh(cmd: string[], timeoutMs = 20_000): { out: string; code: number } {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  void timeoutMs;
  return { out: r.stdout.toString().trim(), code: r.exitCode ?? 1 };
}

async function resolveDoH(host: string): Promise<string | null> {
  for (const base of ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"]) {
    try {
      const res = await fetch(`${base}?name=${host}&type=A`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { Answer?: Array<{ type: number; data?: string }> };
      const a = (j.Answer ?? []).find((x) => x.type === 1 && x.data);
      if (a?.data) return a.data;
    } catch {
      // 换下一个
    }
  }
  return null;
}

function curl(args: string[]): string {
  const r = sh(["curl", "-sS", "-m", "20", "--noproxy", "*", ...args]);
  return r.out;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const si = argv.indexOf("--ssh");
  const sshHost = si >= 0 ? argv[si + 1] : undefined;
  const host = "gaubee.com";
  let failed = 0;

  console.log(`site-endpoint-doctor：${host}`);

  // 1) DNS
  const ip = await resolveDoH(host);
  if (!ip) {
    console.error("  ✗ DoH 解析失败（两个解析器都不可达）");
    return 2;
  }
  console.log(`  当前 A 记录：${ip}`);

  // 2) 直连 80/443
  const code443 = curl(["--resolve", `${host}:443:${ip}`, "-o", "/dev/null", "-w", "%{http_code}", `https://${host}/`]);
  const code80 = curl(["-o", "/dev/null", "-w", "%{http_code}", `http://${ip}/`]);
  console.log(`  直连 443：${code443 || "000"}　直连 80：${code80 || "000"}`);
  if (code443 !== "200") {
    failed++;
    console.log("  ✗ 443 直连不可用（若是反代/CDN，确认是否只接受特定 SNI 或需走代理）");
  }

  // 3) 证书
  const cert = sh([
    "bash",
    "-c",
    `echo | openssl s_client -connect ${ip}:443 -servername ${host} 2>/dev/null | openssl x509 -noout -subject -issuer -enddate 2>/dev/null`,
  ]).out;
  if (cert) {
    for (const line of cert.split("\n")) console.log(`  ${line}`);
    const end = cert.match(/notAfter=(.+)$/m)?.[1];
    if (end) {
      const days = Math.floor((new Date(end).getTime() - Date.now()) / 86_400_000);
      console.log(`  证书剩余 ${days} 天${days < 14 ? "（该续了）" : ""}`);
      if (days < 0) failed++;
    }
  } else {
    console.log("  ! 取不到证书信息");
  }

  // 4) 页面
  const eventsDir = path.join(SITE, "src", "content", "events");
  let newest = "";
  if (existsSync(eventsDir)) {
    newest = readdirSync(eventsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .at(-1)!
      .replace(/\.md$/, "");
  }
  const home = curl(["--resolve", `${host}:443:${ip}`, "-o", "/dev/null", "-w", "%{size_download}", `https://${host}/`]);
  console.log(`  首页字节：${home}（SPA 壳通常约 4.5KB）`);
  if (newest) {
    const page = curl([
      "--resolve",
      `${host}:443:${ip}`,
      "-o",
      "/dev/null",
      "-w",
      "%{http_code} %{size_download}",
      `https://${host}/pages/article/events/${newest}`,
    ]);
    console.log(`  最新 event ${newest}：${page}`);
    if (!page.startsWith("200") || Number(page.split(" ")[1] ?? 0) < 5000) failed++;
  }

  // 5) 边缘 vs 源站
  if (sshHost) {
    const probePath = "/cdn-media/current.json";
    const edgeLen = curl(["--resolve", `${host}:443:${ip}`, "-o", "/dev/null", "-w", "%{size_download}", `https://${host}${probePath}`]);
    const originLen = sh([
      "ssh",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "BatchMode=yes",
      sshHost,
      `curl -sS -m 10 -o /dev/null -w '%{size_download}' --resolve ${host}:443:127.0.0.1 https://${host}${probePath}`,
    ]).out;
    console.log(`  ${probePath}　边缘 ${edgeLen}B vs 源站 ${originLen}B`);
    if (edgeLen !== originLen) {
      console.log("  ! 两边不一致：边缘可能在服务 SPA 回退（或缺该路由），以源站为准判断内容是否已部署");
    }
  } else {
    console.log("  （加 --ssh <host> 可对比边缘与源站）");
  }

  console.log(failed ? `\nENDPOINT FAIL：${failed} 项` : "\nENDPOINT OK：入口可用");
  return failed ? 1 : 0;
}

process.exit(await main());
