/**
 * site-endpoint.ts — 解析站点当前入口 IP（不再硬编码）
 *
 * 背景（2026-11-22 实证）：gaubee.com 的 A 记录一周内换过两次（北京 → 香港 → 新入口）。
 * hls-live-check 与 daily-auto 里写死的 `--resolve ...:47.82.76.102` 在换机后全部失效：
 * 直连旧 IP 的 80/443 已经不通，工具却报「媒体 404 / TLS 不可达」，
 * 看起来像站点坏了，实际只是钉子钉在了旧地址上。
 *
 * 做法：用公共 DoH 查 A 记录（本机 DNS 走 clash fake-ip，系统解析不可信），
 * 带内存缓存与失败兜底。拿不到就返回 null，调用方应显式报错而不是静默直连。
 */

let cached: { ip: string; at: number } | null = null;

const DOH_ENDPOINTS = [
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
];

/** 返回站点当前 A 记录 IP；失败返回 null。缓存 10 分钟。 */
export async function resolveSiteIp(host = "gaubee.com", ttlMs = 600_000): Promise<string | null> {
  if (cached && Date.now() - cached.at < ttlMs) return cached.ip;
  for (const base of DOH_ENDPOINTS) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(host)}&type=A`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { Answer?: Array<{ type: number; data?: string }> };
      const a = (j.Answer ?? []).find((x) => x.type === 1 && x.data);
      if (a?.data) {
        cached = { ip: a.data, at: Date.now() };
        return a.data;
      }
    } catch {
      // 换下一个解析器
    }
  }
  return null;
}

/** 同步版：给 spawnSync 调用方用（内部起一个很短的事件循环等待） */
export function resolveSiteIpSync(host = "gaubee.com"): string | null {
  if (cached) return cached.ip;
  // Bun 的 spawnSync 里不能 await，这里用阻塞式子进程查 DoH，避免引入依赖
  const r = Bun.spawnSync(
    [
      "curl",
      "-sS",
      "-m",
      "6",
      "--noproxy",
      "*",
      "-H",
      "accept: application/dns-json",
      `https://dns.google/resolve?name=${host}&type=A`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  try {
    const j = JSON.parse(r.stdout.toString()) as { Answer?: Array<{ type: number; data?: string }> };
    const a = (j.Answer ?? []).find((x) => x.type === 1 && x.data);
    if (a?.data) {
      cached = { ip: a.data, at: Date.now() };
      return a.data;
    }
  } catch {
    // 落到 null
  }
  return null;
}
