/**
 * x-video-dl.ts — X 视频下载助手（yt-dlp）：临时目录落盘，成功后才迁入目标目录。
 *
 * [2026-10-20 HLS 落地实证] 两条教训合并进同一入口：
 * - 1080p 阶梯下的长视频（47 分钟 720p 源约 220MB）走代理顺序拉 HLS 段，10 分钟
 *   预算在半途被杀（.part 停在 105MB）。这里统一 -N 8 并发分片、更长预算，且不
 *   预清理 .part/.ytdl——yt-dlp 据此续传，重试不从零开始。
 * - yt-dlp 若直接写 staging，被杀后残留的 .part/.ytdl 会被 media-pack scanSource
 *   当成员打进发布卷（扫描无扩展名过滤，100MB+ 半成品还会撞单卷硬限）。因此一律
 *   先落 os.tmpdir()/gaubee-x-video/，拿到完整产物才迁入 destDir。
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { moveFile } from "./move-file.ts";

/** 质量阶梯（2026-10-20 kzf：默认 1080p，至少 720p）：1080p→720p→任意。 */
export const VIDEO_FORMAT = "bv*[height<=1080]+ba/b[height<=1080]/bv*[height<=720]+ba/b[height<=720]/b";
/** 整体安全上限：分片存储后不再受单卷 200MiB 单文件限制，仅防失控。 */
export const MAX_FILESIZE = "2000M";
/** 并发拉段数：x.com 的 HLS 源顺序拉段在高延迟代理下最慢，浏览器本身也是并行取段。 */
const CONCURRENT_FRAGMENTS = "8";
const TMP = path.join(tmpdir(), "gaubee-x-video");
const EXTS = ["mp4", "mkv", "webm"] as const;

export type DownloadResult = { ok: true; file: string; ext: string } | { ok: false; error: string };

/** 瞬时网络故障签名（实证：走代理拉 x.com GraphQL JSON 约 1/3 概率 SSL EOF，紧接着重试即通）。
 *  永久性错误（推文无视频 / 已删除 404 / 私密）不在其中，立即返回不浪费预算。 */
const TRANSIENT = /SSL|EOF occurred|timed out|Timeout|Connection (reset|aborted|refused)|RemoteDisconnected|Temporary failure|HTTP Error (5\d\d|429)|Network is unreachable/i;
const RETRY_DELAYS_MS = [5_000, 20_000];
const KILLED_PREFIX = "进程被终止";

/**
 * 下载推文视频到 destDir/<baseName>.<ext>（ext 取 yt-dlp 实际产出，通常 mp4）。
 * 失败返回可读的单行错误（优先取最后一条 ERROR，而不是 stderr 末行的更新提示）；
 * 瞬时网络错误按 RETRY_DELAYS_MS 退避重试（续传生效，不从零拉）；预算超时被杀不重试
 * （预算按次计，重试会让一条坏视频吃掉数倍时间），.part/.ytdl 留给下次运行续传。
 */
export function downloadVideo(statusUrl: string, destDir: string, baseName: string, timeoutMs: number): DownloadResult {
	for (let attempt = 0; ; attempt++) {
		const r = attemptDownload(statusUrl, destDir, baseName, timeoutMs);
		if (r.ok) return r;
		const delay = RETRY_DELAYS_MS[attempt];
		if (delay === undefined || r.error.startsWith(KILLED_PREFIX) || !TRANSIENT.test(r.error)) return r;
		console.error(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} ${baseName}（${Math.round(delay / 1000)}s 后）：${r.error}`);
		Bun.sleepSync(delay);
	}
}

function attemptDownload(statusUrl: string, destDir: string, baseName: string, timeoutMs: number): DownloadResult {
	mkdirSync(TMP, { recursive: true });
	const tmpNoExt = path.join(TMP, baseName);
	let p: ReturnType<typeof Bun.spawnSync>;
	try {
		p = Bun.spawnSync(
			[
				"yt-dlp",
				"--no-update",
				"-N", CONCURRENT_FRAGMENTS,
				"-f", VIDEO_FORMAT,
				"--max-filesize", MAX_FILESIZE,
				"--no-playlist",
				"--merge-output-format", "mp4",
				"-o", `${tmpNoExt}.%(ext)s`,
				statusUrl,
			],
			{ stdout: "ignore", stderr: "pipe", timeout: timeoutMs },
		);
	} catch (e) {
		// yt-dlp 是软依赖：未安装/不可执行只报 WARN，不阻塞管道
		return { ok: false, error: `yt-dlp 不可用：${e instanceof Error ? e.message : String(e)}`.slice(0, 160) };
	}
	const ext = EXTS.find((e) => existsSync(`${tmpNoExt}.${e}`));
	if (p.exitCode !== 0 || !ext) {
		return { ok: false, error: describeFailure(p, timeoutMs) };
	}
	mkdirSync(destDir, { recursive: true });
	const dest = path.join(destDir, `${baseName}.${ext}`);
	moveFile(`${tmpNoExt}.${ext}`, dest);
	for (const n of readdirSync(TMP)) {
		if (n.startsWith(baseName)) rmSync(path.join(TMP, n), { force: true });
	}
	return { ok: true, file: dest, ext };
}

function describeFailure(p: ReturnType<typeof Bun.spawnSync>, timeoutMs: number): string {
	if (p.exitCode === null || p.signalCode) {
		return `${KILLED_PREFIX}（${p.signalCode ?? "signal"}，预算 ${Math.round(timeoutMs / 1000)}s；.part 已留存可续传）`;
	}
	const lines = new TextDecoder()
		.decode(p.stderr)
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	const err = [...lines].reverse().find((l) => l.startsWith("ERROR")) ?? lines.at(-1);
	if (p.exitCode === 0) return `exit 0 但无产物（${err ?? "可能超出 --max-filesize 被跳过"}）`.slice(0, 160);
	return (err ?? `exit ${p.exitCode}`).slice(0, 160);
}
