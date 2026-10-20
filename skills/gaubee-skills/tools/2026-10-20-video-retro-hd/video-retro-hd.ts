#!/usr/bin/env bun
/**
 * video-retro-hd.ts — 存量低清视频追溯升级：重拉高清源 → 无损切 HLS → 改键 → 重渲染。
 *
 * [2026-10-20 kzf 裁决] 旧 720p 上限 + 190MB 降档护栏压低了部分视频质量；分片存储
 * 落地后单文件限制解除。本工具对 videoLocal 为 mp4 且 media-meta 高度 < --max-h 的条目：
 *   1. yt-dlp 按新阶梯（1080p→720p→任意）拉源到临时目录（lib/x-video-dl.ts：-N 8 并发、
 *      .part 续传、瞬时网络错误退避重试、拿到完整产物才迁出）
 *   2. ffprobe 对比：新高度 ≤ 旧高度 → 无增益，丢弃（源本身上限如此）
 *   3. 有增益 → remuxToHls 切片进 staging/x/<月>/，x.json videoLocal 改指 .m3u8，
 *      media-meta 补 .m3u8 键元数据
 *   4. 收集受影响日期，重渲染（lib/x-rerender.ts：日报覆盖日 --force、其余归档全量重写）
 *
 * 运行：bun video-retro-hd.ts [--limit N] [--ids a,b] [--max-h 720] [--no-render] [--until HH:MM]
 *       bun video-retro-hd.ts --render-pending   # 补渲染 --no-render 批次记下的日期（媒体发布后）
 * 产物在 staging，待 media-pack --patch 入卷；x.json/media-meta 逐条原子写回。
 * 与 06:30 cron 共存：批次用 --until 05:00 --no-render，到点停、页面引用等媒体入卷后再补；
 * 无增益条目记入 retro-hd-nogain.json，续跑不重拉。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "../../scripts/lib.ts";
import { remuxToHls } from "../../scripts/lib/x-hls.ts";
import { localDay, rerenderDays } from "../../scripts/lib/x-rerender.ts";
import { downloadVideo } from "../../scripts/lib/x-video-dl.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const STAGING = path.join(SITE, "cdn-media", "staging", "x");
const STORE = path.join(sourceDir("x-likes"), "x.json");
const META = path.join(sourceDir("x-likes"), "media-meta.json");
/** --no-render 批次留下的待渲染日期（私有数据目录，不进 git） */
const PENDING = path.join(sourceDir("x-likes"), "retro-hd-pending-render.json");
/** 已证实源上限≤现有高度的条目（id → {h, at}），续跑直接跳过 */
const NOGAIN = path.join(sourceDir("x-likes"), "retro-hd-nogain.json");
/** 单条下载预算：长视频（47 分钟 720p 约 220MB）走代理需十几分钟；助手 -N 8 并发 + 续传，超时只丢本条。 */
const DOWNLOAD_TIMEOUT_MS = 45 * 60_000;
/** 限流信号（见主循环注释）；连续 3 次即退避 15 分钟，最多 3 轮；条目间 15s 节流。
 *  节流依据（2026-10-21 02:1x 实证）：每个候选 spawn 一次 yt-dlp = 申请一枚 guest token，2s 间隔下一小时
 *  上百枚，8 分钟退避后仍连续失败；同一时刻隔离单测却全部正常——限的是发放节奏不是具体推文。 */
const THROTTLE_SIGNS = /No video could be found|Unable to download JSON metadata|HTTP Error 429/i;
const STREAK_BACKOFF_AT = 3;
const BACKOFF_MS = 15 * 60_000;
const MAX_BACKOFFS = 3;
const PACE_MS = 15_000;

interface Item {
	id: string;
	author?: string;
	created_at?: string;
	videoLocal?: string[];
}
interface Meta {
	w: number;
	h: number;
	ms?: number;
}

function argOf(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

function probe(abs: string): Meta | null {
	const p = Bun.spawnSync(
		["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", abs],
		{ stdout: "pipe", stderr: "ignore" },
	);
	try {
		const d = JSON.parse(new TextDecoder().decode(p.stdout));
		const s = d.streams?.[0];
		if (s?.width && s?.height) return { w: s.width, h: s.height, ms: Math.round(Number(d.format?.duration ?? 0) * 1000) };
	} catch {
		/* ignore */
	}
	return null;
}

/** 单条落盘：以磁盘为准重读、只改本条键、原子写回（x.json videoLocal + media-meta 新键）。 */
function persist(id: string, m3u8Key: string, newMeta: Meta): void {
	const store = JSON.parse(readFileSync(STORE, "utf8")) as { items: Record<string, Item> };
	const it = store.items[id];
	if (it) {
		it.videoLocal = [m3u8Key];
		writeFileAtomic(STORE, JSON.stringify(store, null, 1));
	}
	const meta = JSON.parse(readFileSync(META, "utf8")) as Record<string, Meta>;
	meta[m3u8Key] = newMeta;
	writeFileAtomic(META, JSON.stringify(meta, null, 1));
}

async function main(): Promise<number> {
	const limit = Number(argOf("--limit") ?? Infinity);
	const maxH = Number(argOf("--max-h") ?? 720);
	const onlyIds = argOf("--ids")?.split(",").filter(Boolean);
	const noRender = process.argv.includes("--no-render");
	const until = argOf("--until"); // HH:MM 本地墙钟：到点不再开新条目（给 06:30 cron 的打包/硬门窗口让路）

	// --render-pending：只补渲染此前 --no-render 批次留下的日期（媒体入卷发布后再让页面引用）
	if (process.argv.includes("--render-pending")) {
		const pending = readPending();
		console.error(`待补渲染日期 ${pending.length}：${pending.join(" ")}`);
		if (pending.length) {
			rerenderDays(pending);
			writeFileAtomic(PENDING, JSON.stringify({ days: [] }, null, 1));
		}
		return 0;
	}

	const store = JSON.parse(await Bun.file(STORE).text()) as { items: Record<string, Item> };
	const meta = JSON.parse(await Bun.file(META).text()) as Record<string, Meta>;
	const noGainSeen = readNoGain();

	const candidates = Object.values(store.items).filter((it) => {
		const key = it.videoLocal?.[0] ?? "";
		if (!key.endsWith("-video.mp4")) return false;
		if (onlyIds) return onlyIds.includes(it.id);
		if (noGainSeen[it.id]) return false; // 上次已证实源上限如此，不再重拉
		const m = meta[key];
		return !!m && m.h < maxH;
	});
	console.error(
		`候选 ${candidates.length}（videoLocal=mp4 且高度<${maxH}，已排除无增益记录 ${Object.keys(noGainSeen).length}）${Number.isFinite(limit) ? `，本次最多 ${limit}` : ""}${until ? `，截止 ${until}` : ""}`,
	);

	const tmp = path.join(tmpdir(), "video-retro-hd");
	mkdirSync(tmp, { recursive: true });
	let upgraded = 0;
	let noGain = 0;
	let failed = 0;
	let bytes = 0;
	let deferred = 0;
	const touchedDays = new Set<string>();
	// 限流识别（2026-10-21 实证）：X 对被限流的 guest token 返回去掉媒体的降级推文，yt-dlp 报
	// 「No video could be found」——孤立出现是真没视频，连续出现是限流（批次尾部连续 25 条全失败，
	// 单独复测均能拿到格式）。连续命中即暂停让窗口过去；多轮仍限流则停批次，剩余下次续跑。
	let streak = 0;
	let backoffs = 0;
	let processed = 0;

	for (const it of candidates.slice(0, limit)) {
		if (until && nowHHMM() >= until) {
			deferred = candidates.length - upgraded - noGain - failed;
			console.error(`  到达截止 ${until}，停止开新条目（剩余 ${deferred} 条下次续跑）`);
			break;
		}
		if (processed++ > 0) Bun.sleepSync(PACE_MS); // 每个候选（含失败路径）之间统一节流
		const oldKey = it.videoLocal![0]!;
		const oldH = meta[oldKey]!.h;
		const month = (it.created_at ?? "").slice(0, 7);
		const statusUrl = `https://x.com/${it.author ?? "i"}/status/${it.id}`;

		// 助手在自己的临时目录落盘并保留 .part/.ytdl 续传，这里拿到的已是完整产物
		const dl = downloadVideo(statusUrl, tmp, `${it.id}-video`, DOWNLOAD_TIMEOUT_MS);
		if (!dl.ok) {
			failed++;
			console.error(`  FAIL 下载 ${it.id}：${dl.error}`);
			if (THROTTLE_SIGNS.test(dl.error) && ++streak >= STREAK_BACKOFF_AT) {
				if (backoffs >= MAX_BACKOFFS) {
					deferred = candidates.length - upgraded - noGain - failed;
					console.error(`  连续失败 ${streak} 次且已退避 ${backoffs} 轮，疑似持续限流——停止本次批次（剩余 ${deferred} 条下次续跑）`);
					break;
				}
				backoffs++;
				console.error(`  连续失败 ${streak} 次（疑似限流）：暂停 ${BACKOFF_MS / 60_000} 分钟后继续（第 ${backoffs}/${MAX_BACKOFFS} 轮）`);
				Bun.sleepSync(BACKOFF_MS);
				streak = 0;
			}
			continue;
		}
		streak = 0;
		const mp4 = dl.file;
		if (dl.ext !== "mp4") {
			failed++;
			rmSync(mp4, { force: true });
			console.error(`  FAIL ${it.id}：产物为 ${dl.ext}，非 mp4 不切片`);
			continue;
		}
		const newMeta = probe(mp4);
		if (!newMeta || newMeta.h <= oldH) {
			noGain++;
			rmSync(mp4, { force: true });
			if (newMeta) recordNoGain(it.id, newMeta.h); // 源上限如此，下次运行直接跳过不重拉
			console.error(`  无增益 ${it.id}：源 ${newMeta?.h ?? "?"}p ≤ 现有 ${oldH}p`);
			continue;
		}
		// 直接从临时目录切片进 staging 月目录（段先落位、playlist 最后，与 media-pack 扫描并发安全）
		const hls = remuxToHls(mp4, month, it.id, path.join(STAGING, month));
		if (!hls) {
			failed++;
			rmSync(mp4, { force: true });
			continue;
		}
		// 逐条落盘：重读磁盘上的 x.json / media-meta 只改本条再原子写回——批次可能跑数小时并与
		// 06:30 cron 交叠，整批内存态最后一次性写回会覆盖 cron 期间新增的条目；逐条也让中途被杀
		// 时已升级的条目全部保留（1.8MB 文件读改写 20ms，332 条可忽略）
		persist(it.id, hls.m3u8Key, newMeta);
		it.videoLocal = [hls.m3u8Key];
		bytes += hls.bytes;
		upgraded++;
		if (it.created_at) {
			const day = localDay(it.created_at);
			touchedDays.add(day);
			if (noRender) addPendingDay(day); // 逐条记 pending：批次被 kill 也不丢待渲染日期（首轮实证丢了 74 日，靠日志捞回）
		}
		console.error(`  升级 ${it.id}：${oldH}p → ${newMeta.h}p，${hls.segments} 段 ${(hls.bytes / 1048576).toFixed(1)} MB`);
	}

	console.error(
		`\n收据：升级 ${upgraded}｜无增益 ${noGain}｜失败 ${failed}｜截止顺延 ${deferred}｜新增分片 ${(bytes / 1048576).toFixed(1)} MB｜涉及日期 ${touchedDays.size}`,
	);

	if (upgraded > 0) {
		if (noRender) {
			// 页面引用推迟到媒体入卷发布之后（R9：媒体可达才闭环）；日期已逐条记入 pending，--render-pending 消费
			console.error(`  涉及日期已记入待渲染清单（累计 ${readPending().length} 日）：媒体发布后执行 --render-pending`);
		} else {
			rerenderDays(touchedDays);
		}
	}
	return failed > 0 && upgraded === 0 ? 1 : 0;
}

/** 本地墙钟 HH:MM（Asia/Shanghai；hourCycle h23 避免个别 ICU 把午夜写成 24:00） */
function nowHHMM(): string {
	return new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
}

function readPending(): string[] {
	if (!existsSync(PENDING)) return [];
	const d = JSON.parse(readFileSync(PENDING, "utf8")) as { days?: string[] };
	return Array.isArray(d.days) ? d.days : [];
}

function addPendingDay(day: string): void {
	const merged = [...new Set([...readPending(), day])].sort();
	writeFileAtomic(PENDING, JSON.stringify({ days: merged }, null, 1));
}

function readNoGain(): Record<string, { h: number; at: string }> {
	if (!existsSync(NOGAIN)) return {};
	return JSON.parse(readFileSync(NOGAIN, "utf8")) as Record<string, { h: number; at: string }>;
}

function recordNoGain(id: string, h: number): void {
	const all = readNoGain();
	all[id] = { h, at: new Date().toISOString() };
	writeFileAtomic(NOGAIN, JSON.stringify(all, null, 1));
}

const code = await main();
process.exit(code);
