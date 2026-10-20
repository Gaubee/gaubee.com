#!/usr/bin/env bun
/**
 * x-posters-backfill.ts — 视频 poster 覆盖审计与回灌（文件 + x.json 接线 + 重渲染）。
 *
 * 背景：日报/归档的 <video> 由生成器按 x.json 的 posterLocal 输出 poster 属性，
 * 当日新视频常缺 poster → 站点黑盒（01841 实证）。本工具两档：
 *   audit（默认）：扫 src/content/events/*.md，统计 <video> 总数 / 带 poster 数 / 缺口数，
 *                 列出最近 5 个缺口样例（repo 内零写入，纯只读报告）。
 *   --fill-local：对缺 poster 的条目——
 *                 ① 封面文件：staging 已有 <id>-poster.jpg 直接用；没有则从 staging 的
 *                    <id>-video.mp4 或 <id>.m3u8（HLS 分片）ffmpeg 抽 0.5s 首帧写回 staging；
 *                    staging 无视频副本但 manifest 已有该 poster 对象的，只接线不生成；
 *                 ② 接线：x.json 该条 posterLocal = canonical key（渲染器只认这个字段——
 *                    2026-10-20 首版只写文件不接线，30 张封面被 x-media-audit 判成孤儿，实证补课）；
 *                 ③ 重渲染涉及日期（lib/x-rerender.ts），--no-render 可跳过。
 *
 * 运行：bun x-posters-backfill.ts [--fill-local] [--no-render]
 * 产物在 staging，待 media-pack --patch 入卷；x.json 原子写回。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "../../scripts/lib.ts";
import { localDay, rerenderDays } from "../../scripts/lib/x-rerender.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");
const STAGING = path.join(SITE, "cdn-media", "staging", "x");
const MANIFEST_DIR = path.join(SITE, "cdn-media", "manifest");
const STORE = path.join(sourceDir("x-likes"), "x.json");
const VIDEO_RE = /<video[^>]*>/g;
/** 视频 src 两种形态：旧单文件 <id>-video.mp4 / 分片 <id>.m3u8 */
const SRC_RE = /src="\/cdn-media\/x\/(\d{4}-\d{2})\/(\d{15,})(?:-video\.mp4|\.m3u8)"/;

interface Item {
	id: string;
	created_at?: string;
	videoLocal?: string[];
	posterLocal?: string;
}

function videoTags(): { tag: string; file: string }[] {
	const out: { tag: string; file: string }[] = [];
	for (const name of readdirSync(EVENTS)) {
		if (!name.endsWith(".md")) continue;
		const file = path.join(EVENTS, name);
		const tags = readFileSync(file, "utf8").match(VIDEO_RE) ?? [];
		for (const tag of tags) out.push({ tag, file });
	}
	return out;
}

/** 当前 manifest 的对象键集合（x/<月>/<文件>）；指针缺失按空集处理（只影响「只接线」分支）。 */
function manifestKeys(): Set<string> {
	const currentFile = path.join(MANIFEST_DIR, "current.json");
	if (!existsSync(currentFile)) return new Set();
	const gen = JSON.parse(readFileSync(currentFile, "utf8")).gen;
	const manifestFile = path.join(MANIFEST_DIR, `manifest-${gen}.json`);
	if (!existsSync(manifestFile)) return new Set();
	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
	return new Set((manifest.objects ?? []).map((o: { key: string }) => o.key));
}

function extractPoster(src: string, out: string): boolean {
	const p = Bun.spawnSync(
		["ffmpeg", "-y", "-v", "error", "-i", src, "-ss", "00:00:00.5", "-frames:v", "1", "-q:v", "3", out],
		{ stdout: "ignore", stderr: "pipe" },
	);
	return p.exitCode === 0 && existsSync(out);
}

function main(): number {
	const fill = process.argv.includes("--fill-local");
	const noRender = process.argv.includes("--no-render");
	const tags = videoTags();
	const withPoster = tags.filter((t) => t.tag.includes("poster="));
	const missing = tags.filter((t) => !t.tag.includes("poster="));

	console.error(`<video> 总数 ${tags.length}｜带 poster ${withPoster.length}｜缺 poster ${missing.length}`);
	for (const m of missing.slice(0, 5)) {
		const id = m.tag.match(SRC_RE)?.[2] ?? "(unknown)";
		console.error(`  缺口样例：${id}（${path.basename(m.file)}）`);
	}

	if (!fill) {
		if (missing.length > 0) {
			console.error(`\nAUDIT：缺口 ${missing.length}（--fill-local 可回灌：staging 有视频副本的抽帧，manifest 已有封面的只接线）`);
			return 1;
		}
		console.error("\nAUDIT：poster 全覆盖 ✓");
		return 0;
	}

	const store = JSON.parse(readFileSync(STORE, "utf8")) as { items: Record<string, Item> };
	const packed = manifestKeys();
	let generated = 0;
	let wired = 0;
	let skipped = 0;
	const seen = new Set<string>();
	const days = new Set<string>();
	for (const m of missing) {
		const ref = m.tag.match(SRC_RE);
		if (!ref) {
			skipped++;
			continue;
		}
		const [, month, id] = ref as unknown as [string, string, string];
		if (seen.has(id)) continue; // 同一视频可能出现在日报与归档两处
		seen.add(id);
		const it = store.items[id];
		if (!it) {
			skipped++;
			continue;
		}
		const posterName = `${id}-poster.jpg`;
		const posterAbs = path.join(STAGING, month, posterName);
		const posterKey = `x/${month}/${posterName}`;
		if (!existsSync(posterAbs) && !packed.has(posterKey)) {
			const src = [`${id}-video.mp4`, `${id}.m3u8`].map((n) => path.join(STAGING, month, n)).find((p) => existsSync(p));
			if (!src || !extractPoster(src, posterAbs)) {
				skipped++; // staging 无视频副本且 manifest 无封面（真源在 Releases，需先 media-pack 下载）
				continue;
			}
			generated++;
			console.error(`  抽帧 ${posterName}`);
		}
		if (!it.posterLocal) {
			it.posterLocal = `cdn-media/${posterKey}`;
			wired++;
			if (it.created_at) days.add(localDay(it.created_at));
		}
	}
	if (wired > 0) writeFileAtomic(STORE, JSON.stringify(store, null, 1));
	console.error(`\n回灌收据：抽帧 ${generated}｜接线 posterLocal ${wired}｜跳过（无副本无封面/抽帧失败/条目缺失）${skipped}｜涉及日期 ${days.size}`);
	if (wired > 0 && !noRender) rerenderDays(days);
	console.error("封面文件在 staging，待 media-pack --patch 入卷；poster 属性已随重渲染写入事件文件。");
	return 0;
}

const code = main();
process.exit(code);
