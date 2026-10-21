#!/usr/bin/env bun
/**
 * cdn-usage-report — cdn-media 用量与增长报告（R2 决策支持）。
 *
 * 背景（2026-10-21）：单日补丁 1.57GB 远超 500MB 水位，Releases 总量 5.16GB，
 * runbook 要求在单月补丁 >500MB 时提示 kzf 评估外置存储。本工具把决策数据一条命令出齐，
 * 数据源全部本地（manifest 各代 + current.json），零网络：
 *   a) 最新代按月统计：对象数 / 字节 / 视频与分段、图片、其他计数（按字节降序）
 *   b) 最近一次补丁增量：与上一代 manifest 逐键 diff，按月列新增对象数与字节
 *   c) 代际趋势：保留的每一代的总对象数与总字节，标出增量最大的代
 *   d) 规则建议：任一月份的单次补丁 >500MB（runbook 水位）即提示评估 R2
 *
 * 运行：bun tools/2026-10-22-cdn-usage-report/cdn-usage-report.ts [--json]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MEDIA_REPO =
	process.env.GAUBEE_CDN_REPO ?? path.resolve(import.meta.dir, "..", "..", "..", "..", "cdn-media");
const MANIFEST_DIR = path.join(MEDIA_REPO, "manifest");
const PATCH_WATERMARK = 500 * 1024 ** 2;

interface Obj {
	key: string;
	size: number;
}
interface Manifest {
	gen: number;
	objects?: Obj[];
}

function fmtBytes(n: number): string {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	return `${(n / 1024).toFixed(0)} KB`;
}

function loadManifests(): Manifest[] {
	const gens = readdirSync(MANIFEST_DIR)
		.map((f) => /^manifest-(\d+)\.json$/.exec(f)?.[1])
		.filter((g): g is string => !!g)
		.map(Number)
		.sort((a, b) => a - b);
	return gens.map((gen) => {
		const m = JSON.parse(readFileSync(path.join(MANIFEST_DIR, `manifest-${gen}.json`), "utf8")) as Manifest;
		return { gen, objects: m.objects ?? [] };
	});
}

function byMonth(objects: Obj[]): Map<string, { count: number; bytes: number; segments: number; media: number }> {
	const out = new Map<string, { count: number; bytes: number; segments: number; media: number }>();
	for (const o of objects) {
		const month = o.key.split("/")[1] ?? "?";
		const e = out.get(month) ?? { count: 0, bytes: 0, segments: 0, media: 0 };
		e.count++;
		e.bytes += o.size;
		if (/\.seg\d+\.ts$/.test(o.key)) e.segments++;
		else e.media++;
		out.set(month, e);
	}
	return out;
}

function main(): number {
	const asJson = process.argv.includes("--json");
	if (!existsSync(path.join(MANIFEST_DIR, "current.json"))) {
		console.error("current.json 不存在（未初始化的 cdn-media？）");
		return 2;
	}
	const manifests = loadManifests();
	if (manifests.length === 0) {
		console.error("没有任何 manifest-<gen>.json");
		return 2;
	}
	const latest = manifests.at(-1)!;
	const prev = manifests.at(-2);

	// a) 最新代按月统计
	const months = [...byMonth(latest.objects!).entries()].sort((a, b) => b[1].bytes - a[1].bytes);
	const totalBytes = latest.objects!.reduce((s, o) => s + o.size, 0);

	// b) 最近一次补丁增量（相邻代逐键 diff）
	const patchMonths = new Map<string, { count: number; bytes: number }>();
	if (prev) {
		const prevKeys = new Set(prev.objects!.map((o) => o.key));
		for (const o of latest.objects!) {
			if (prevKeys.has(o.key)) continue;
			const month = o.key.split("/")[1] ?? "?";
			const e = patchMonths.get(month) ?? { count: 0, bytes: 0 };
			e.count++;
			e.bytes += o.size;
			patchMonths.set(month, e);
		}
	}

	// c) 代际趋势
	const trend = manifests.map((m) => ({
		gen: m.gen,
		objects: m.objects!.length,
		bytes: m.objects!.reduce((s, o) => s + o.size, 0),
	}));
	let biggestJump = { from: 0, to: 0, bytes: 0 };
	for (let i = 1; i < trend.length; i++) {
		const d = trend[i]!.bytes - trend[i - 1]!.bytes;
		if (d > biggestJump.bytes) biggestJump = { from: trend[i - 1]!.gen, to: trend[i]!.gen, bytes: d };
	}

	// d) 规则建议
	const overWatermark = [...patchMonths.entries()].filter(([, v]) => v.bytes > PATCH_WATERMARK);

	if (asJson) {
		console.log(
			JSON.stringify(
				{
					gen: latest.gen,
					totalObjects: latest.objects!.length,
					totalBytes,
					months: months.map(([month, v]) => ({ month, ...v })),
					latestPatch: latest.gen === prev?.gen ? null : { fromGen: prev?.gen ?? null, months: [...patchMonths.entries()].map(([month, v]) => ({ month, ...v })) },
					trend,
					overWatermarkMonths: overWatermark.map(([m]) => m),
				},
				null,
				1,
			),
		);
		return 0;
	}

	console.log(`cdn-media 用量报告（gen ${latest.gen}，保留代 ${manifests.map((m) => m.gen).join(",")}）`);
	console.log(`总量：${latest.objects!.length} 对象 / ${fmtBytes(totalBytes)}\n`);
	console.log("按月（字节降序，前 12）：");
	for (const [month, v] of months.slice(0, 12)) {
		console.log(`  ${month}  ${String(v.count).padStart(5)} 对象  ${fmtBytes(v.bytes).padStart(9)}（分段 ${v.segments} / 媒体 ${v.media}）`);
	}
	if (prev) {
		console.log(`\n最近一次补丁（gen ${prev.gen} → ${latest.gen}）：${[...patchMonths.values()].reduce((s, v) => s + v.count, 0)} 对象 / ${fmtBytes([...patchMonths.values()].reduce((s, v) => s + v.bytes, 0))}`);
		for (const [month, v] of [...patchMonths.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
			console.log(`  ${month}  +${v.count} 对象  +${fmtBytes(v.bytes)}`);
		}
	}
	console.log("\n代际趋势：");
	for (let i = 0; i < trend.length; i++) {
		const t = trend[i]!;
		const delta = i > 0 ? `（+${fmtBytes(t.bytes - trend[i - 1]!.bytes)}）` : "";
		console.log(`  gen-${String(t.gen).padStart(2, "0")}  ${String(t.objects).padStart(5)} 对象  ${fmtBytes(t.bytes).padStart(9)} ${delta}`);
	}
	console.log(`  单代最大增量：gen ${biggestJump.from} → ${biggestJump.to}（+${fmtBytes(biggestJump.bytes)}）`);
	if (overWatermark.length) {
		console.log(`\n建议：最近补丁中 ${overWatermark.map(([m]) => m).join("、")} 单月超 500MB 水位——评估外置存储（R2）接入。`);
	} else {
		console.log("\n水位：最近补丁均在 500MB 内，暂无需接 R2。");
	}
	return 0;
}

process.exit(main());
