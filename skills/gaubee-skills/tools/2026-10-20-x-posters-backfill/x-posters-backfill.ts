#!/usr/bin/env bun
/**
 * x-posters-backfill.ts — 视频 poster 覆盖审计与本地回灌。
 *
 * 背景：日报/归档的 <video> 由生成器按 media-meta 与 x.json 的 posterLocal 输出 poster，
 * 当日新视频常缺 poster → 站点黑盒（01841 实证）。本工具两档：
 *   audit（默认）：扫 src/content/events/*.md，统计 <video> 总数 / 带 poster 数 / 缺口数，
 *                 列出最近 5 个缺口样例（repo 内零写入，纯只读报告）。
 *   --fill-local：对缺 poster 且视频文件恰好存在于 cdn-media/staging 的条目，
 *                 用 ffmpeg 抽首帧写 <id>-poster.jpg 回 staging（canonical key 布局），
 *                 输出回灌收据；staging 无文件的条目跳过计数（真源在 Releases）。
 *
 * 运行：bun x-posters-backfill.ts [--fill-local]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");
const STAGING = path.join(SITE, "cdn-media", "staging", "x");
const VIDEO_RE = /<video[^>]*>/g;

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

function main(): number {
	const fill = process.argv.includes("--fill-local");
	const tags = videoTags();
	const withPoster = tags.filter((t) => t.tag.includes("poster="));
	const missing = tags.filter((t) => !t.tag.includes("poster="));

	console.error(`<video> 总数 ${tags.length}｜带 poster ${withPoster.length}｜缺 poster ${missing.length}`);
	for (const m of missing.slice(0, 5)) {
		const id = m.tag.match(/\/(\d{15,})-video\.mp4/)?.[1] ?? "(unknown)";
		console.error(`  缺口样例：${id}（${path.basename(m.file)}）`);
	}

	if (!fill) {
		if (missing.length > 0) {
			console.error(`\nAUDIT：缺口 ${missing.length}（--fill-local 可回灌本地 staging 有副本的部分；真源在 Releases 的需先 media-pack 下载）`);
			return 1;
		}
		console.error("\nAUDIT：poster 全覆盖 ✓");
		return 0;
	}

	let filled = 0;
	let skipped = 0;
	for (const m of missing) {
		const src = m.tag.match(/src="\/cdn-media\/x\/([^"]+)-video\.mp4"/)?.[1];
		if (!src) {
			skipped++;
			continue;
		}
		const local = path.join(STAGING, `${src}-video.mp4`);
		if (!existsSync(local)) {
			skipped++; // staging 无副本（已清理，真源在 Releases）
			continue;
		}
		const outDir = path.dirname(path.join(STAGING, src));
		const out = path.join(outDir, `${path.basename(src)}-poster.jpg`);
		const p = Bun.spawnSync(
			["ffmpeg", "-y", "-v", "error", "-i", local, "-ss", "00:00:00.5", "-frames:v", "1", "-q:v", "3", out],
			{ stdout: "ignore", stderr: "pipe" },
		);
		if (p.exitCode === 0 && existsSync(out)) {
			filled++;
			console.error(`  回灌 ${path.basename(out)}`);
		} else {
			skipped++;
		}
	}
	console.error(`\n回灌收据：填充 ${filled}｜跳过（staging 无副本或抽帧失败）${skipped}`);
	console.error("回灌文件在 staging，待 media-pack --patch 入卷后由生成器输出 poster 属性。");
	return 0;
}

const code = main();
process.exit(code);
