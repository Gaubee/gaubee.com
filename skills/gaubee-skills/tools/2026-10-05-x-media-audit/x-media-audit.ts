#!/usr/bin/env bun
/**
 * x-media-audit.ts — X 档案媒体库对账（gaubee-skills 工具工坊提案，2026-10-05）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] 原始需求（kzf 近期工作：X 档案媒体库 + 视频本地化）：x-media-backfill 带 4.5GB
 *   体积护栏与「GitHub 单文件 100MB 拒收」红线，媒体库一致性目前只能靠肉眼；需要一条命令完成对账。
 * - 1. 引用完整性：x.json 的 mediaLocal/videoLocal ↔ 磁盘 static/x-media 双向对账（断链引用 + 孤儿文件）
 * - 2. 本地化覆盖：按图片/视频侧分别统计「有远程 URL 无本地副本」的条目（backfill 视频优先策略
 *   与体积护栏都不会自动补齐的缺口，须人工决策）
 * - 3. 体积审计：总量/构成/按月分布/Top 大文件；≥90MB 警戒、≥100MB git push 拒收线
 * - 4. 门禁语义：发现断链/孤儿/超限任一硬问题退出码 1，否则 0（可挂日常维护流程）
 *
 * 运行：bun tools/2026-10-05-x-media-audit/x-media-audit.ts [--top N]
 * 前置：x.json 已由 x-archive-import / x-likes-fetch 建立；媒体根 = GAUBEE_SITE（缺省仓库根）/static/x-media
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const MEDIA_REL_ROOT = "x-media";
const MEDIA_ROOT = path.join(SITE, "static", MEDIA_REL_ROOT);
const PUSH_LIMIT = 100 * 1024 * 1024; // GitHub 单文件硬拒收线
const PUSH_WARN = 90 * 1024 * 1024; // 警戒线：留出重编码余量

interface Tweet {
  id: string;
  kind: string;
  media?: string[];
  video?: string[];
  mediaLocal?: string[];
  videoLocal?: string[];
  synChecked?: boolean;
}
interface XStore {
  items: Record<string, Tweet>;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** Dirent 手递归扫盘（零依赖，替代 glob）；返回相对 MEDIA_ROOT 的路径与字节数 */
function walkFiles(root: string): { rel: string; size: number }[] {
  const out: { rel: string; size: number }[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 媒体根不存在时按空库处理，报告里如实体现
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) out.push({ rel: path.relative(root, abs), size: statSync(abs).size });
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let top = 10;
  const topIdx = args.indexOf("--top");
  if (topIdx >= 0) top = Number.parseInt(args[topIdx + 1] ?? "", 10) || 10;

  const store: XStore = JSON.parse(
    await Bun.file(path.join(sourceDir("x-likes"), "x.json")).text(),
  );
  const items = Object.values(store.items);

  // —— 引用面：本地副本声明 + 远程未本地化缺口 ——
  const refs = new Map<string, string>(); // rel(x-media/...) -> tweet id
  const kindCount = new Map<string, number>();
  let pending = 0;
  let noLocalMedia = 0;
  let noLocalVideo = 0;
  for (const t of items) {
    kindCount.set(t.kind, (kindCount.get(t.kind) ?? 0) + 1);
    if (!t.synChecked) pending++;
    for (const rel of t.mediaLocal ?? []) if (!refs.has(rel)) refs.set(rel, t.id);
    for (const rel of t.videoLocal ?? []) if (!refs.has(rel)) refs.set(rel, t.id);
    if (t.media?.length && !t.mediaLocal?.length) noLocalMedia++;
    if (t.video?.length && !t.videoLocal?.length) noLocalVideo++;
  }  const kindLine = [...kindCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");

  // —— 磁盘面：存在集 + 体积 ——
  const files = walkFiles(MEDIA_ROOT).map((f) => ({
    rel: `${MEDIA_REL_ROOT}/${f.rel}`,
    size: f.size,
  }));
  const disk = new Map(files.map((f) => [f.rel, f.size]));
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const months = [...new Set(files.map((f) => f.rel.split("/")[1] ?? ""))].filter(Boolean).sort();

  const broken = [...refs.keys()].filter((rel) => !disk.has(rel));
  const orphanRels = files.filter((f) => !refs.has(f.rel));
  const orphanBytes = orphanRels.reduce((s, f) => s + f.size, 0);
  const overLimit = files.filter((f) => f.size >= PUSH_LIMIT);
  const nearLimit = files
    .filter((f) => f.size >= PUSH_WARN && f.size < PUSH_LIMIT)
    .sort((a, b) => b.size - a.size);

  // —— 体积构成与分布 ——
  const extOf = (rel: string) => (rel.match(/\.(\w{3,5})$/)?.[1] ?? "").toLowerCase();
  const isVideo = (rel: string) => extOf(rel) === "mp4";
  const videoFiles = files.filter((f) => isVideo(f.rel));
  const videoBytes = videoFiles.reduce((s, f) => s + f.size, 0);
  const imageFiles = files.filter((f) => !isVideo(f.rel));
  const imageBytes = imageFiles.reduce((s, f) => s + f.size, 0);
  const byMonth = new Map<string, number>();
  for (const f of files) {
    const m = f.rel.split("/")[1] ?? "?";
    byMonth.set(m, (byMonth.get(m) ?? 0) + f.size);
  }
  const topMonths = [...byMonth.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topFiles = [...files].sort((a, b) => b.size - a.size).slice(0, top);

  // —— 报告 ——
  const lines: string[] = [];
  lines.push("# X 媒体库对账");
  lines.push(
    `库存 ${items.length} 条动态（${kindLine}）· 待回灌 ${pending} 条`,
  );
  lines.push(
    `本地引用：图片条目 ${[...refs.keys()].filter((r) => !isVideo(r)).length} · 视频条目 ${[...refs.keys()].filter((r) => isVideo(r)).length} ｜ 远程未本地化：图片 ${noLocalMedia} · 视频 ${noLocalVideo}`,
  );
  lines.push(
    `本地库：${files.length} 文件 · ${fmtBytes(totalBytes)}（${months[0] ?? "?"} → ${months.at(-1) ?? "?"}，${months.length} 个月）`,
  );
  lines.push("");
  lines.push(
    `引用完整性：断链 ${broken.length}${broken.length ? " ✗" : " ✓"} ｜ 孤儿文件 ${orphanRels.length}${orphanRels.length ? ` ✗（${fmtBytes(orphanBytes)}）` : " ✓"}`,
  );
  lines.push(
    `本地化覆盖：${noLocalMedia + noLocalVideo === 0 ? "全量已本地化 ✓" : `缺口 ${noLocalMedia + noLocalVideo} 条（图片侧 ${noLocalMedia} · 视频侧 ${noLocalVideo}；backfill 不会自动补齐：视频条目只本地化视频）`}`,
  );

  if (overLimit.length || nearLimit.length) {
    lines.push("");
    lines.push(`## git push 风险（GitHub 单文件 ${PUSH_LIMIT / 1024 / 1024}MB 拒收线）`);
    for (const f of overLimit)
      lines.push(`✗ 拒收线以上：${f.rel} — ${fmtBytes(f.size)}（push 必失败，需重编码/外置）`);
    if (nearLimit.length) {
      lines.push(`⚠ 警戒（≥${PUSH_WARN / 1024 / 1024}MB）${nearLimit.length} 个：`);
      for (const f of nearLimit) lines.push(`- ${f.rel} — ${fmtBytes(f.size)}`);
    }
  }

  lines.push("");
  lines.push("## 体积构成");
  lines.push(
    `视频 ${fmtBytes(videoBytes)}（${videoFiles.length} 个）· 图片等 ${fmtBytes(imageBytes)}（${imageFiles.length} 个）`,
  );
  if (topMonths.length)
    lines.push(
      `按月 Top5：${topMonths.map(([m, b]) => `${m} ${fmtBytes(b)}`).join(" · ")}`,
    );
  lines.push(`大文件 Top${top}：`);
  for (const f of topFiles) lines.push(`- ${f.rel} — ${fmtBytes(f.size)}`);

  if (broken.length) {
    lines.push("");
    lines.push(`## 断链引用（x.json 声明本地副本但磁盘缺失）${broken.length} 个`);
    for (const rel of broken.slice(0, top)) lines.push(`- ${rel} ← ${refs.get(rel)}`);
    if (broken.length > top) lines.push(`- … 共 ${broken.length} 个`);
  }
  if (orphanRels.length) {
    lines.push("");
    lines.push(`## 孤儿文件（磁盘存在但无条目引用，可核对后清理）${orphanRels.length} 个 · ${fmtBytes(orphanBytes)}`);
    for (const f of [...orphanRels].sort((a, b) => b.size - a.size).slice(0, top))
      lines.push(`- ${f.rel} — ${fmtBytes(f.size)}`);
    if (orphanRels.length > top) lines.push(`- … 共 ${orphanRels.length} 个`);
  }

  console.log(lines.join("\n"));
  // 门禁：硬问题（断链/孤儿/超限）才失败；警戒与缺口只提示
  if (broken.length || orphanRels.length || overLimit.length) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
