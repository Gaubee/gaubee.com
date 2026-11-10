#!/usr/bin/env bun
/**
 * catchup-scan — 补跑缺口扫描（某日期区间内各源的漏跑清单）
 *
 * 背景（2026-11-04 实证）：连续几天没跑维护后，缺口要靠手工作业盘点——哪个源
 * changes 断了、哪天日报没写、周报月报漏了。本工具把这件事一条命令做完：给定
 * 日期区间，逐日核对四个源的 changes/history、两份日报的 reports 文件与站点
 * event 是否存在，输出「要补什么」的清单。
 *
 * 用法：bun tools/2026-11-04-catchup-scan/catchup-scan.ts [--from 2026-10-31] [--to 2026-11-03]
 *   默认区间 = 最近一个有 changes 的日期 + 1 到昨天。
 * 退出码：0 = 无缺口；1 = 有缺口。纯本地只读。
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SOURCES = path.join(DATA, "sources");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");
const EVENTS = path.join(SITE, "src", "content", "events");

function localDay(ms: number): string {
	return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function daysBetween(from: string, to: string): string[] {
	const out: string[] = [];
	let t = new Date(`${from}T00:00:00+08:00`).getTime();
	const end = new Date(`${to}T00:00:00+08:00`).getTime();
	while (t <= end) {
		out.push(localDay(t));
		t += 24 * 3600_000;
	}
	return out;
}

/** 单个源 changes 目录里最晚的日期（只看 <= 昨天，今天的抓取不算已覆盖） */
function latestFor(src: string, yesterday: string): string {
	let best = "";
	const dir = path.join(SOURCES, src, "changes");
	if (!existsSync(dir)) return "";
	for (const f of readdirSync(dir)) {
		const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
		if (m && m[1]! <= yesterday && m[1]! > best) best = m[1]!;
	}
	return best;
}

/** 缺口起点按「最早断掉的源」算：取各源最晚日期的最小值。
 *  2026-11-11 实证：今天的 stars fetch 先写了当日 changes，若取最大值会把区间
 *  压成「今天..昨天」而空转，commits 明明缺一天却报「无硬缺口」。 */
function latestChangeDate(yesterday: string): string {
	const dates = ["github-stars", "github-commits", "github-deps", "x-likes"]
		.map((src) => latestFor(src, yesterday))
		.filter(Boolean)
		.sort();
	return dates[0] ?? "";
}

function eventExists(slug: string): boolean {
	if (!existsSync(EVENTS)) return false;
	return readdirSync(EVENTS).some((f) => f.endsWith(`.${slug}.md`));
}

function main(): number {
	const argv = process.argv.slice(2);
	const arg = (flag: string, dflt: string) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? (argv[i + 1] ?? dflt) : dflt;
	};
	const yesterday = localDay(Date.now() - 24 * 3600_000);
	const latest = latestChangeDate(yesterday);
	const fromDefault = latest
		? localDay(new Date(`${latest}T00:00:00+08:00`).getTime() + 24 * 3600_000)
		: yesterday;
	const from = arg("--from", fromDefault);
	const to = arg("--to", yesterday);

	if (from > to) {
		console.log(`区间为空：各源 changes 已覆盖到 ${to}（最早断源的最晚日期 ${latest || "无"}），无需补跑`);
		return 0;
	}
	console.log(`补跑区间 ${from} .. ${to}（最早断源 ${latest || "无"}，考察口径：报告日 = T-1）`);
	const days = daysBetween(from, to);
	const gaps: string[] = [];
	const soft: string[] = [];

	for (const d of days) {
		const runDay = localDay(new Date(`${d}T00:00:00+08:00`).getTime() + 24 * 3600_000);
		const rows: string[] = [];
		// changes 口径：commits 按报告日（可按日回溯补齐）；stars/deps/x 按运行日，
		// 且三者都是「累积差分」源——漏跑的中间日会把差额并进最近一次运行日，
		// 缺中间日属补跑常态，只作提示不作硬缺口（2026-11-04 补跑实证）。
		const srcChecks: [string, string, string, boolean][] = [
			["github-stars", "星标", runDay, false],
			["github-commits", "提交", d, true],
			["github-deps", "依赖", runDay, false],
			["x-likes", "X", runDay, false],
		];
		for (const [src, label, key, hard] of srcChecks) {
			const ok = existsSync(path.join(SOURCES, src, "changes", `${key}.json`));
			rows.push(`${label}${ok ? "✓" : "·"}`);
			if (!ok && hard) gaps.push(`${d} 缺 ${label} changes（${src}/changes/${key}.json，可按日回填）`);
			if (!ok && !hard) soft.push(`${d} 无 ${label} changes（累积差分源，并入最近运行日）`);
		}
		const ghReport = existsSync(path.join(REPORTS, `${d}.md`))
			? "✓"
			: eventExists(`github-daily-${d}`)
				? "✓"
				: "✗";
		const xReport = existsSync(path.join(REPORTS, `${d}-x.md`))
			? "✓"
			: eventExists(`x-daily-${d}`)
				? "✓"
				: "·";
		rows.push(`GH日报${ghReport}`, `X日报${xReport}`);
		if (ghReport === "✗") gaps.push(`${d} 缺 GitHub 日报（reports 与 event 都没有）`);
		if (xReport === "·") soft.push(`${d} 无 X 日报（该日无独立差分时属正常）`);
		console.log(`  ${d}  ${rows.join("  ")}`);
	}

	if (soft.length) console.log(`\n提示 ${soft.length} 项（非硬缺口，累积差分源的正常形态）：`);
	if (soft.length) for (const s of soft.slice(0, 6)) console.log(`  · ${s}`);
	if (soft.length > 6) console.log(`  · …共 ${soft.length} 项`);

	if (gaps.length) {
		console.error(`\n必须补的缺口 ${gaps.length} 项：`);
		for (const g of gaps) console.error(`  - ${g}`);
		return 1;
	}
	console.log("\n无硬缺口：commits 齐全，GitHub 日报齐全");
	return 0;
}

process.exit(main());
