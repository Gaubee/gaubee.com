#!/usr/bin/env bun
/**
 * retro-status — video-retro-hd 追溯完成度报告。
 *
 * 回答三个问题：HLS 化进行到哪了、还剩多少、剩余都在哪些月份（预估剩余流量）。
 * 数据源全本地：x.json（videoLocal 键形态）、media-meta（高度）、retro-hd-nogain（已证实无增益）。
 *
 * 运行：bun tools/2026-10-23-retro-status/retro-status.ts
 * 退出码：0；剩余候选为 0 时打印「追溯完成」。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

const D = sourceDir("x-likes");

interface Item {
	id: string;
	created_at?: string;
	videoLocal?: string[];
}
interface Meta {
	h: number;
}

function main(): number {
	const store = JSON.parse(readFileSync(path.join(D, "x.json"), "utf8")) as { items: Record<string, Item> };
	const meta = JSON.parse(readFileSync(path.join(D, "media-meta.json"), "utf8")) as Record<string, Meta>;
	const noGain = existsSync(path.join(D, "retro-hd-nogain.json"))
		? (JSON.parse(readFileSync(path.join(D, "retro-hd-nogain.json"), "utf8")) as Record<string, unknown>)
		: {};

	const items = Object.values(store.items);
	const videos = items.filter((t) => t.videoLocal?.length);
	const hls = videos.filter((t) => t.videoLocal![0]!.endsWith(".m3u8"));
	const remaining = videos.filter((t) => {
		const k = t.videoLocal![0]!;
		if (!k.endsWith("-video.mp4")) return false;
		if (noGain[t.id]) return false;
		const m = meta[k];
		return !!m && m.h < 720;
	});
	const noGainCount = videos.filter((t) => t.videoLocal![0]!.endsWith("-video.mp4") && noGain[t.id]).length;

	const byMonth = new Map<string, number>();
	for (const t of remaining) {
		const k = t.videoLocal![0]!;
		const month = k.split("/")[2] ?? "?";
		byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
	}

	console.log(`视频条目 ${videos.length}｜已 HLS 化 ${hls.length}（${((hls.length / videos.length) * 100).toFixed(1)}%）｜仍单文件 mp4 ${videos.length - hls.length}`);
	console.log(`剩余候选 ${remaining.length}（<720p 且未证实无增益）｜无增益记录 ${noGainCount}｜>=$720p 单文件 ${videos.length - hls.length - remaining.length - noGainCount}`);
	if (remaining.length) {
		console.log("剩余按月（待打包流量随升级产生）：");
		for (const [m, n] of [...byMonth.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${m}  ${n} 条`);
		console.log("续跑：bun tools/2026-10-20-video-retro-hd/video-retro-hd.ts --until 23:59 --no-render");
	} else {
		console.log("追溯完成：存量低清视频已全部处理（升级或证实无增益）。");
	}
	return 0;
}

process.exit(main());
