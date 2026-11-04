#!/usr/bin/env bun
/**
 * x-daily-guard — X 日报归窗防线（生成后、发布前的必查项）
 *
 * 背景（2026-10-22 三连渲染事故 + 2026-11-04 补跑重现）：`x-daily-events.ts --date D`
 * 在某些情况下会为一整份差分生成多份报告（例如补跑时对「当日无独立差分」的日期沿用
 * 同一批条目），于是同一条推文落进两个以上的日报窗。生成器本身是 fail-open 的，
 * 本工具在发布前把这件事变成硬门：读目标日报里的推文 id，逐条核对它在所有
 * x-daily / x-archive 报告与事件里出现的「窗日期」集合，出现多个即判违规。
 *
 * 用法：bun tools/2026-11-04-x-daily-guard/x-daily-guard.ts [--date 2026-11-03] [--file 路径]
 *   默认核对昨天对应的 reports/daily/<date>-x.md。
 * 退出码：0 = 每条恰在当窗；1 = 有跨窗重复或文件缺失。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");
const EVENTS = path.join(SITE, "src", "content", "events");
const STATUS_RE = /\/status\/(\d{15,})/g;

function localDay(ms: number): string {
	return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 日期 → 该窗里出现的推文 id 集合（reports 与 events 双侧合并，同一窗去重） */
function indexWindows(): Map<string, Set<string>> {
	const byDate = new Map<string, Set<string>>();
	const add = (date: string, ids: Iterable<string>) => {
		const set = byDate.get(date) ?? new Set<string>();
		for (const id of ids) set.add(id);
		byDate.set(date, set);
	};
	const collect = (file: string): string[] =>
		[...readFileSync(file, "utf8").matchAll(STATUS_RE)].map((m) => m[1]!);

	if (existsSync(REPORTS)) {
		for (const f of readdirSync(REPORTS)) {
			const m = f.match(/^(\d{4}-\d{2}-\d{2})(-x)?\.md$/);
			if (m) add(m[1]!, collect(path.join(REPORTS, f)));
		}
	}
	if (existsSync(EVENTS)) {
		for (const f of readdirSync(EVENTS)) {
			const m = f.match(/^0\d+\.x-(?:daily|archive)-(\d{4}-\d{2}-\d{2})\.md$/);
			if (m) add(m[1]!, collect(path.join(EVENTS, f)));
		}
	}
	return byDate;
}

function main(): number {
	const argv = process.argv.slice(2);
	const arg = (flag: string, dflt: string) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? (argv[i + 1] ?? dflt) : dflt;
	};
	const date = arg("--date", localDay(Date.now() - 24 * 3600_000));
	const file = arg("--file", path.join(REPORTS, `${date}-x.md`));
	if (!existsSync(file)) {
		console.error(`目标报告不存在：${file}`);
		return 1;
	}
	const mine = [...new Set([...readFileSync(file, "utf8").matchAll(STATUS_RE)].map((m) => m[1]!))];
	const windows = indexWindows();

	const stray: string[] = [];
	for (const id of mine) {
		const hits: string[] = [];
		for (const [d, ids] of windows) if (ids.has(id)) hits.push(d);
		const others = hits.filter((d) => d !== date).sort();
		if (others.length) stray.push(`${id} 除 ${date} 外还出现在 ${others.join("、")}`);
	}

	console.log(`核对 ${path.basename(file)}：${mine.length} 条推文，窗口索引 ${windows.size} 天`);
	if (stray.length) {
		console.error(`跨窗重复 ${stray.length} 条（归窗不变量：每条捕捉恰落一个窗）：`);
		for (const s of stray.slice(0, 12)) console.error(`  - ${s}`);
		if (stray.length > 12) console.error(`  - …共 ${stray.length} 条`);
		return 1;
	}
	console.log(`OK：全部条目只在 ${date} 这一个窗内出现`);
	return 0;
}

process.exit(main());
