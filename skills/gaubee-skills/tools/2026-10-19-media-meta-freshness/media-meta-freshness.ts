#!/usr/bin/env bun
/**
 * media-meta-freshness.ts — media-meta 悬空守卫（2026-10-18 事故复发防线）。
 *
 * 背景：media-meta.ts（裁决 16 的实现）写成后从未接入 cron 管道，manifest 已换代而
 * media-meta.json 停在旧代——当日日报/归档的 <video> 一律裸标签（黑盒、布局跳动）。
 * 本工具对照 manifest-<gen>.json 与 media-meta.json 的键覆盖：manifest 里存在而
 * media-meta 缺失的媒体对象数即「悬空缺口」，>0 则 exit 1。
 *
 * 运行：bun media-meta-freshness.ts [--manifest <manifest-<gen>.json>] [--meta <media-meta.json>]
 *   默认 manifest = 站内 cdn-media/manifest/current.json 解析出的当前代；
 *   默认 meta = ~/.gaubee-skills/data/sources/x-likes/media-meta.json
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const MEDIA_REPO = path.join(SITE, "cdn-media");

interface ManifestObject {
	key?: string;
	width?: number;
	height?: number;
}

function argOf(argv: string[], flag: string): string | undefined {
	const i = argv.indexOf(flag);
	return i >= 0 ? argv[i + 1] : undefined;
}

function main(): number {
	const argv = process.argv;
	const manifestFile = argOf(argv, "--manifest") ?? (() => {
		const current = JSON.parse(readFileSync(path.join(MEDIA_REPO, "manifest", "current.json"), "utf8")) as { gen?: number };
		if (typeof current.gen !== "number") throw new Error("current.json 缺 gen 字段");
		return path.join(MEDIA_REPO, "manifest", `manifest-${current.gen}.json`);
	})();
	const metaFile = argOf(argv, "--meta") ?? path.join(process.env.HOME ?? "", ".gaubee-skills", "data", "sources", "x-likes", "media-meta.json");

	if (!existsSync(manifestFile)) {
		console.error(`FAIL manifest 不存在：${manifestFile}`);
		return 1;
	}
	if (!existsSync(metaFile)) {
		console.error(`FAIL media-meta.json 不存在：${metaFile}（media-meta.ts 未跑过？）`);
		return 1;
	}

	const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { objects?: ManifestObject[] };
	const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;

	const missing: string[] = [];
	let total = 0;
	for (const o of manifest.objects ?? []) {
		if (typeof o.key !== "string") continue;
		total++;
		const key = `cdn-media/${o.key}`;
		if (!(key in meta)) missing.push(key);
	}

	console.error(`manifest: ${manifestFile}`);
	console.error(`对象 ${total}，media-meta 覆盖 ${total - missing.length}，悬空缺口 ${missing.length}`);
	if (missing.length > 0) {
		console.error(`\nFAIL：${missing.length} 个对象缺元数据（media-meta.ts 未随 manifest 换代重跑）。样例：`);
		for (const k of missing.slice(0, 5)) console.error(`  - ${k}`);
		console.error(`修复：bun scripts/media-meta.ts`);
		return 1;
	}
	console.error("PASS：media-meta 全量覆盖当前 manifest");
	return 0;
}

const code = main();
process.exit(code);
