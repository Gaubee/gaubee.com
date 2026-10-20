/**
 * x-hls.ts — 视频分片化（HLS）助手：mp4 → m3u8 + ts 段（无损 remux，秒级）。
 *
 * [2026-10-20 kzf 裁决：视频分片存储] 1080p 长视频单文件超 media-pack 单卷
 * 200MiB 硬限（下载护栏被迫压到 480p/360p）。分片后每段几 MB，任意长度 1080p
 * 都能入卷；播放端 Safari 原生 HLS，其余浏览器由播放器懒加载 hls.js（MSE）。
 *
 * canonical key 布局（扁平，与既有平面键空间兼容）：
 *   cdn-media/x/<月>/<id>.m3u8        播放列表（段引用为相对文件名）
 *   cdn-media/x/<月>/<id>.segNNNN.ts  段对象
 * mp4 源在 remux 成功后删除（不双存）；失败保留 mp4 走旧路径（WARN）。
 *
 * 落盘顺序（与 media-pack 扫描并发安全）：ffmpeg 在系统临时目录产出 → 段逐个迁入
 * staging → playlist 最后迁入。media-pack 任一时刻扫到 playlist，其引用的段必已齐；
 * 只扫到部分段则 playlist 还没到、x.json 也还没改键，段先入卷无害（下次按 size+sha256
 * 幂等复用）。半成品永不出现在 staging。
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { moveFile } from "./move-file.ts";

export interface HlsResult {
	/** canonical key：cdn-media/x/<月>/<id>.m3u8 */
	m3u8Key: string;
	segments: number;
	bytes: number;
}

/** mp4 无损切 HLS 到 destDir（缺省 = mp4 所在目录）。成功删除源 mp4 并返回 canonical key；失败返回 null（源保留）。 */
export function remuxToHls(absMp4: string, month: string, id: string, destDir: string = path.dirname(absMp4)): HlsResult | null {
	const dir = destDir;
	mkdirSync(dir, { recursive: true });
	const work = path.join(tmpdir(), "gaubee-x-hls", id);
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	const workM3u8 = path.join(work, `${id}.m3u8`);
	const p = Bun.spawnSync(
		[
			"ffmpeg", "-y", "-v", "error",
			"-i", absMp4,
			"-c", "copy",
			"-f", "hls",
			"-hls_time", "6",
			"-hls_playlist_type", "vod",
			"-hls_flags", "independent_segments",
			"-hls_segment_filename", path.join(work, `${id}.seg%04d.ts`),
			workM3u8,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	if (p.exitCode !== 0 || !existsSync(workM3u8)) {
		console.error(`WARN HLS remux 失败 ${id}：${new TextDecoder().decode(p.stderr).slice(0, 160)}`);
		rmSync(work, { recursive: true, force: true });
		return null;
	}
	const segs = readdirSync(work)
		.filter((n) => n.startsWith(`${id}.seg`) && n.endsWith(".ts"))
		.sort();
	if (segs.length === 0) {
		console.error(`WARN HLS remux 无段产出 ${id}，保留 mp4`);
		rmSync(work, { recursive: true, force: true });
		return null;
	}
	let bytes = statSync(workM3u8).size;
	for (const n of segs) {
		bytes += statSync(path.join(work, n)).size;
		moveFile(path.join(work, n), path.join(dir, n));
	}
	// 段引用规整：ffmpeg 写出的相对名即 <id>.segNNNN.ts（同目录）✓ 无需改写 playlist
	moveFile(workM3u8, path.join(dir, `${id}.m3u8`));
	rmSync(work, { recursive: true, force: true });
	rmSync(absMp4);
	return { m3u8Key: `cdn-media/x/${month}/${id}.m3u8`, segments: segs.length, bytes };
}

/** 该 canonical key 是否分片视频。 */
export function isHlsKey(key: string): boolean {
	return key.endsWith(".m3u8");
}
