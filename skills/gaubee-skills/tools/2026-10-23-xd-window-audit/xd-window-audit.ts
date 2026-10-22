#!/usr/bin/env bun
/**
 * xd-window-audit — X 日报归窗对账：每条被捕捉的点赞应恰好出现在一个窗里。
 *
 * 规则（方案 a + 2026-10-22 三连渲染事故的工具化）：changes/<R>.json 的 added 条目
 * 应恰好出现在「报告日 = R-1」的 x-daily-<报告日>.md 里一次；该日有日报则归档不收。
 * 对每个 changes 文件逐条统计其在 src/content/events 的 x-daily 与 x-archive 文件中
 * 同日期窗内的出现次数：=1 ✓；0 ✗ 缺窗；>1 ✗ 重复。
 *
 * 运行：bun tools/2026-10-23-xd-window-audit/xd-window-audit.ts [--limit N]（默认全部 changes）
 * 退出码：0 = 全部恰一窗；1 = 存在缺窗/重复。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");
const CHANGES = path.join(process.env.HOME, ".gaubee-skills", "data", "sources", "x-likes", "changes");

/** 本地日（Asia/Shanghai，与生成器 sv-SE 口径一致） */
function localDay(ms: number): string {
	return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function prevDay(runDate: string): string {
	const ms = new Date(`${runDate}T00:00:00+08:00`).getTime() - 24 * 3600_000;
	return localDay(ms);
}

function main(): number {
	const limitIdx = process.argv.indexOf("--limit");
	const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1] ?? Infinity) || Infinity : Infinity;
	const changeFiles = readdirSync(CHANGES)
		.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
		.sort()
		.slice(-limit);

	// 事件文件索引：推文 id → [文件名]（文件名带日期后缀，一次建索引）
	const index = new Map<string, string[]>();
	for (const name of readdirSync(EVENTS)) {
		if (!/x-(daily|archive)-\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue;
		const text = readFileSync(path.join(EVENTS, name), "utf8");
		for (const m of text.matchAll(/\/status\/(\d{15,})/g)) {
			const ids = index.get(m[1]!) ?? [];
			ids.push(name);
			index.set(m[1]!, ids);
		}
	}

	let ok = 0;
	let checked = 0;
	const problems: string[] = [];
	for (const f of changeFiles) {
		const runDate = f.slice(0, 10);
		const windowDay = prevDay(runDate); // 报告日 = 抓取运行日的前一天（T-1）
		const ch = JSON.parse(readFileSync(path.join(CHANGES, f), "utf8")) as {
			added?: { html_url?: string }[];
		};
		for (const a of ch.added ?? []) {
			const id = a.html_url?.match(/status\/(\d{15,})/)?.[1];
			if (!id) continue;
			checked++;
			const inWindow = (index.get(id) ?? []).filter((n) => n.endsWith(`-${windowDay}.md`));
			if (inWindow.length === 1) ok++;
			else if (inWindow.length === 0) problems.push(`缺窗 ${id}（run ${runDate} → 窗 ${windowDay}）：0 处引用`);
			else problems.push(`重复 ${id}（run ${runDate} → 窗 ${windowDay}）：${inWindow.join("、")}`);
		}
	}

	console.log(`changes 文件 ${changeFiles.length} 个，核对条目 ${checked}：恰一窗 ${ok}｜异常 ${problems.length}`);
	for (const p of problems) console.error(`  ${p}`);
	
	return problems.length ? 1 : 0;
}

process.exit(main());
