// staging-forecast.ts — staging 到期预报（工坊 2026-10-12 提案 2）
//
// 动机（2026-10-12 实证）：周一 staging-clean dry-run 显示 895 文件 / 226 MB 全部
// 「未满 7 天」——即下周一它们将一次性到期。此前清理是黑盒：要么每周空操作，
// 要么某周突然删除数百文件。预报把删除曲线提前 7 天摊开给维护 agent 看。
//
// 口径：与 staging-clean 完全同源（loadCurrentState + walkStagingX + RETENTION_MS），
// 只统计「已入卷且已发布」的文件，按 mtime + 7 天的到期日分布（对齐周一 cron）。
// 未入卷 / 未发布单列——它们不受保留期影响，不会被时间自动消化。
// 本工具只读；实际删除的唯一执行者仍是 staging-clean（四安全条件 fail-closed）。
//
// 用法: bun tools/2026-10-12-staging-forecast/staging-forecast.ts
import { loadCurrentState } from "../../../../cdn-media/tools/media-pack.ts";
import {
  RETENTION_MS,
  STAGING_X,
  fmtBytes,
  walkStagingX,
} from "../../../../cdn-media/tools/staging-clean.ts";

const localDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const state = loadCurrentState();
if (state.state !== "ok") {
  console.error(`[staging-forecast] manifest 状态异常（${state.state}），fail-closed 不预报`);
  process.exit(1);
}
const keyToVolume = new Map(state.manifest.objects.map((o) => [o.key, o.volume] as const));
const publishedVolumes = new Set(
  state.pointer.volumes
    .filter((v) => typeof v.asset_id === "number" && v.asset_id >= 1 && v.url)
    .map((v) => v.name),
);

const now = Date.now();
const dueByDay = new Map<string, { n: number; bytes: number }>();
let dueNowN = 0;
let dueNowBytes = 0;
let orphanN = 0;
let orphanBytes = 0;
let unpublishedN = 0;
let unpublishedBytes = 0;

const files = walkStagingX(STAGING_X);
for (const f of files) {
  const vol = keyToVolume.get(`x/${f.rel}`);
  if (vol === undefined) {
    orphanN += 1;
    orphanBytes += f.size;
    continue;
  }
  if (!publishedVolumes.has(vol)) {
    unpublishedN += 1;
    unpublishedBytes += f.size;
    continue;
  }
  const due = f.mtimeMs + RETENTION_MS;
  if (due <= now) {
    dueNowN += 1;
    dueNowBytes += f.size;
    continue;
  }
  const day = localDay(due);
  const agg = dueByDay.get(day) ?? { n: 0, bytes: 0 };
  agg.n += 1;
  agg.bytes += f.size;
  dueByDay.set(day, agg);
}

console.log(
  `[staging-forecast] manifest gen ${state.gen}：已发布卷 ${publishedVolumes.size}/${state.pointer.volumes.length}`,
);
console.log(`[staging-forecast] staging/x 共 ${files.length} 文件 / ${fmtBytes(files.reduce((s, f) => s + f.size, 0))}`);
console.log(`  立即可删（已满保留期）：${dueNowN} 文件 / ${fmtBytes(dueNowBytes)}`);
if (dueByDay.size) {
  console.log("  到期预报（mtime + 7 天，按到期日）：");
  for (const day of [...dueByDay.keys()].sort()) {
    const a = dueByDay.get(day)!;
    console.log(`    ${day}：${a.n} 文件 / ${fmtBytes(a.bytes)}`);
  }
} else {
  console.log("  到期预报：（未来 7 天内无新到期文件）");
}
console.log(`  不受保留期影响（需人工跟进）：未入卷 ${orphanN} / ${fmtBytes(orphanBytes)} · 未发布 ${unpublishedN} / ${fmtBytes(unpublishedBytes)}`);
