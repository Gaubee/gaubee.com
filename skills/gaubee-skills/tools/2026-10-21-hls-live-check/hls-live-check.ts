#!/usr/bin/env bun
/**
 * hls-live-check.ts — 线上 HLS 内容级验收（R9：部署收敛 + 媒体可达才闭环，不以 200 为准）。
 *
 * 对 x.json 里 videoLocal 为 .m3u8 的条目抽样核对三件事：
 *   1. playlist：GET /cdn-media/x/<月>/<id>.m3u8 → 200 + application/vnd.apple.mpegurl + 正文含 #EXTM3U
 *   2. 首段：GET（Range 0-0）/cdn-media/x/<月>/<id>.seg0000.ts → 206/200 + video/mp2t
 *   3. 页面：含该 .m3u8 引用的事件文件对应的 /pages/article/events/<name> HTML 里确实出现该键
 * 三态收据：OK（媒体+页面都对）｜MEDIA_ONLY（媒体可达但页面仍引用旧 mp4 → 待 --render-pending）｜
 * BROKEN（页面引用了但媒体不可达 → 真断链）｜UNPUBLISHED（媒体未发布且页面未引用 → 等 cron 入卷，正常）。
 * 直连源站 IP（curl --resolve）绕开本机 clash fake-ip 对 DNS 的污染。
 *
 * 运行：bun hls-live-check.ts [--limit 20] [--all] [--ids a,b] [--host gaubee.com] [--ip 39.107.213.167]
 * 退出码：0 = 无 BROKEN；1 = 存在 BROKEN。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");
const STORE = path.join(sourceDir("x-likes"), "x.json");

interface Item {
	id: string;
	created_at?: string;
	videoLocal?: string[];
}

function argOf(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Resp {
	status: number;
	ctype: string;
	body: string;
}

/** curl 直连源站（--noproxy 绕开 clash，--resolve 绕开 fake-ip DNS）：状态码 + content-type + 正文（超 64KB 截断，playlist 够用）。
 *  头块可能不止一个（代理 CONNECT 的 200 / 1xx 续行），取最后一个真实响应头。 */
function get(host: string, ip: string, pathname: string, range?: string): Resp {
	const args = ["curl", "-sS", "-m", "20", "--noproxy", "*", "--resolve", `${host}:443:${ip}`, "-D", "-", "-o", "-"];
	if (range) args.push("-r", range);
	args.push(`https://${host}${pathname}`);
	const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
	let out = new TextDecoder().decode(p.stdout);
	let head = "";
	for (;;) {
		const sep = out.indexOf("\r\n\r\n");
		if (sep < 0 || !out.startsWith("HTTP/")) break;
		head = out.slice(0, sep);
		out = out.slice(sep + 4);
		const code = Number(/^HTTP\/\S+\s+(\d{3})/.exec(head)?.[1] ?? 0);
		if (code >= 200 && !/Connection established/i.test(head.split("\r\n")[0] ?? "")) break; // 真实响应头
	}
	const status = Number(/^HTTP\/\S+\s+(\d{3})/m.exec(head)?.[1] ?? 0);
	const ctype = (/^content-type:\s*([^\r\n;]+)/im.exec(head)?.[1] ?? "").trim().toLowerCase();
	return { status, ctype, body: out.slice(0, 65536) };
}

function main(): number {
	const host = argOf("--host") ?? "gaubee.com";
	const ip = argOf("--ip") ?? "39.107.213.167";
	const all = process.argv.includes("--all");
	const limit = all ? Infinity : Number(argOf("--limit") ?? 20);
	const onlyIds = argOf("--ids")?.split(",").filter(Boolean);

	const store = JSON.parse(readFileSync(STORE, "utf8")) as { items: Record<string, Item> };
	let hls = Object.values(store.items).filter((it) => it.videoLocal?.[0]?.endsWith(".m3u8"));
	if (onlyIds) hls = hls.filter((it) => onlyIds.includes(it.id));
	hls.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
	const sample = hls.slice(0, limit);

	// 事件文件索引：哪个文件引用了哪个 .m3u8（一次读完，避免每条 grep 整目录）
	const refs = new Map<string, string>();
	for (const name of readdirSync(EVENTS)) {
		if (!name.endsWith(".md")) continue;
		const text = readFileSync(path.join(EVENTS, name), "utf8");
		for (const m of text.matchAll(/\/cdn-media\/x\/\d{4}-\d{2}\/(\d+)\.m3u8/g)) refs.set(m[1]!, name.slice(0, -3));
	}

	console.error(`HLS 条目 ${hls.length}，本次核对 ${sample.length}（${host} → ${ip}）`);
	const tally = { OK: 0, MEDIA_ONLY: 0, BROKEN: 0, UNPUBLISHED: 0 };
	const broken: string[] = [];
	for (const it of sample) {
		const key = it.videoLocal![0]!; // cdn-media/x/<月>/<id>.m3u8
		const pl = get(host, ip, `/${key}`);
		const plOk = pl.status === 200 && pl.ctype === "application/vnd.apple.mpegurl" && pl.body.startsWith("#EXTM3U");
		const seg = get(host, ip, `/${key.replace(/\.m3u8$/, ".seg0000.ts")}`, "0-0");
		const segOk = (seg.status === 206 || seg.status === 200) && seg.ctype === "video/mp2t";
		const mediaOk = plOk && segOk;
		const page = refs.get(it.id);
		let pageOk = false;
		if (page) {
			const html = get(host, ip, `/pages/article/events/${page}`);
			pageOk = html.status === 200 && html.body.includes(`/${key}`);
		}
		let verdict: keyof typeof tally;
		if (mediaOk && pageOk) verdict = "OK";
		else if (mediaOk) verdict = "MEDIA_ONLY";
		else if (pageOk) verdict = "BROKEN";
		else verdict = "UNPUBLISHED";
		tally[verdict]++;
		const detail = `playlist ${pl.status}/${pl.ctype || "-"} 段 ${seg.status}/${seg.ctype || "-"} 页面 ${page ? (pageOk ? "引用✓" : "未引用") : "无事件文件"}`;
		if (verdict === "BROKEN") broken.push(`${it.id} ${detail}`);
		if (verdict !== "OK") console.error(`  ${verdict.padEnd(11)} ${it.id}  ${detail}`);
	}
	console.error(
		`\n收据：OK ${tally.OK}｜MEDIA_ONLY（待补渲染）${tally.MEDIA_ONLY}｜UNPUBLISHED（待入卷）${tally.UNPUBLISHED}｜BROKEN ${tally.BROKEN}`,
	);
	if (broken.length) {
		console.error("BROKEN 明细（页面已引用但媒体不可达）：");
		for (const b of broken) console.error(`  - ${b}`);
		return 1;
	}
	return 0;
}

process.exit(main());
