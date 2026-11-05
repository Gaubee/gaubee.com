#!/usr/bin/env bun
/**
 * cdn-cache-doctor — cdn-base 缓存与单飞滞留检测
 *
 * 背景（2026-11-04 线上事故）：新 volume 首次回源失败后，admission 预留与 per-key
 * flight 锁未释放——inflight_reserved 卡在某个字节数不动，该对象的后续所有请求
 * 永久排队（实测 150s 无响应）。当时是靠 hls-live-check 报 BROKEN 才发现的。
 *
 * 本工具把这件事变成主动探测：读两次 admin stats（间隔 N 秒），若
 * inflight_reserved 非零且两次完全相同，即判「滞留」（正常回源在秒级完成，不会
 * 两次取值一模一样地卡住）；同时报告缓存水位与抽样对象的可达性，并给出处置建议。
 *
 * 用法：
 *   bun tools/2026-11-05-cdn-cache-doctor/cdn-cache-doctor.ts                 # 默认 ssh gaubee-cloud
 *   bun tools/2026-11-05-cdn-cache-doctor/cdn-cache-doctor.ts --gap 20 --sample 2
 * 退出码：0 = 健康；1 = 滞留或不可达；2 = 用法/环境异常。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

interface Stats {
  cache: {
    bytes: number;
    high_bytes: number;
    low_bytes: number;
    objects: number;
    inflight_reserved: number;
    undiscardable: number;
    poisoned_active?: number;
  };
  manifest: { gen: number; loaded: boolean; objects: number };
}

function argOf(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

function sh(cmd: string, timeout = 30_000): { out: string; code: number } {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout });
  return { out: ((r.stdout ?? "") + (r.stderr ?? "")).trim(), code: r.status ?? 1 };
}

function readStats(sshHost: string): { stats: Stats | null; err: string } {
  // 只取 stdout：ssh 的 post-quantum 警告等噪音都走 stderr，混进 JSON 会解析失败
  const r = spawnSync(`command ssh ${sshHost} "curl -s -m 10 http://127.0.0.1:8081/cdn-media-admin/stats"`, {
    shell: true,
    encoding: "utf8",
    timeout: 30_000,
  });
  const out = (r.stdout ?? "").trim();
  if ((r.status ?? 1) !== 0 || !out.startsWith("{"))
    return { stats: null, err: out.slice(0, 120) || `exit ${r.status}` };
  try {
    return { stats: JSON.parse(out) as Stats, err: "" };
  } catch {
    return { stats: null, err: `stats JSON 解析失败（前 80 字：${out.slice(0, 80)}）` };
  }
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;

async function main(): Promise<number> {
  const sshHost = argOf("--ssh", "gaubee-cloud");
  const gap = Math.max(3, Number(argOf("--gap", "15")) || 15);
  const sample = Math.max(0, Number(argOf("--sample", "2")) || 0);

  const first = readStats(sshHost);
  if (!first.stats) {
    console.error(`FAIL 取不到 admin stats（${first.err}）`);
    console.error("hint：先跑 ssh-channel-doctor 确认通道，再跑 manifest-lag-watch 看 gen");
    return 2;
  }
  console.log(
    `manifest gen=${first.stats.manifest.gen} loaded=${first.stats.manifest.loaded} objects=${first.stats.manifest.objects}`,
  );
  const c1 = first.stats.cache;
  console.log(
    `缓存 ${gb(c1.bytes)} / 上限 ${gb(c1.high_bytes)}（${c1.objects} 对象），inflight_reserved=${c1.inflight_reserved}`,
  );

  // 滞留判定：非零预留两次取值完全相同 → 卡住（正常回源秒级完成）
  if (c1.inflight_reserved > 0) {
    console.log(`预留非零，等 ${gap}s 后复测…`);
    Bun.sleepSync(gap * 1000);
    const second = readStats(sshHost);
    if (!second.stats) {
      console.error("FAIL 第二次取 stats 失败");
      return 1;
    }
    const c2 = second.stats.cache;
    if (c2.inflight_reserved === c1.inflight_reserved) {
      console.error(
        `FAIL 单飞滞留：inflight_reserved=${c1.inflight_reserved} 字节在 ${gap}s 内两次完全相同（正常回源不会如此）`,
      );
      console.error("  影响：该对象（可能不是唯一）的所有后续请求会排队等待 flight 锁，表现为请求无响应");
      console.error("  处置：核实上游可达后重启静态服务容器（docker restart gaubeeos）清锁；");
      console.error("        若反复发生，需在回源失败分支补预留与锁的释放（服务端 media.rs）");
      return 1;
    }
    console.log(`预留 ${c1.inflight_reserved} → ${c2.inflight_reserved}，有推进（正常回源中）`);
  } else {
    console.log("预留为 0：无在途单飞");
  }

  // 水位提示
  const c = first.stats.cache;
  const ratio = c.bytes / c.high_bytes;
  if (ratio > 0.95)
    console.log(`提示：缓存水位 ${(ratio * 100).toFixed(0)}%，接近 high，新对象入缓存会先触发逐出`);
  if (c.undiscardable > 0) console.log(`提示：${c.undiscardable} 个对象删除失败（undiscardable），字节仍在账上`);

  // 抽样可达性：从本地 manifest 取真实对象，公网直连源站 IP 请求
  if (sample > 0) {
    const ip = sh(`ssh -G ${sshHost} 2>/dev/null | awk '/^hostname /{print $2}'`).out.trim();
    if (!ip) {
      console.error("FAIL 解析不到源站 IP（ssh -G）");
      return 2;
    }
    const cdnDir = process.env.CDN_MEDIA_DIR ?? path.resolve(import.meta.dir, "..", "..", "..", "..", "cdn-media");
    const localCurrent = path.join(cdnDir, "manifest", "current.json");
    let keys: string[] = [];
    try {
      const cur = (await Bun.file(localCurrent).json()) as {
        gen: number;
        manifest?: string;
      };
      const localGen = cur.gen;
      if (localGen !== first.stats.manifest.gen)
        console.log(
          `提示：本地指针 gen=${localGen} 高于服务器 gen=${first.stats.manifest.gen}——manifest 刷新窗口内属正常，持续滞后请跑 manifest-lag-watch`,
        );
      const mf = (await Bun.file(path.join(cdnDir, "manifest", `manifest-${localGen}.json`)).json()) as {
        objects: { key: string }[];
      };
      keys = mf.objects.map((o) => o.key);
    } catch {
      console.log("提示：读本地 manifest 失败，抽样跳过");
    }
    if (keys.length) {
      for (let i = 0; i < Math.min(sample, keys.length); i++) {
        const key = keys[Math.floor((keys.length / (sample + 1)) * (i + 1))]!;
        const url = `https://gaubee.com/cdn-media/${key}`;
        const r = sh(
          `curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time 45 --noproxy '*' --resolve gaubee.com:443:${ip} ${JSON.stringify(url)}`,
          60_000,
        );
        const [code, time] = r.out.split(" ");
        const ok = code === "200" || code === "206";
        console.log(`抽样 ${ok ? "OK " : "FAIL"} ${key} → ${code}（${time}s）`);
        if (!ok) {
          console.error("  抽样对象不可达：先直接 curl 该对象确认，再查服务器日志");
          return 1;
        }
      }
    }
  }

  console.log("cdn-cache-doctor OK：无滞留，manifest 与缓存读数正常");
  return 0;
}

process.exit(await main());
