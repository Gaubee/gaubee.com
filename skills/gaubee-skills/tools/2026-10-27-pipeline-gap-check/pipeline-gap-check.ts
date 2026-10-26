#!/usr/bin/env bun
/**
 * pipeline-gap-check — 每日管道漏跑门禁
 *
 * 背景（2026-10-21 实证）：X 会话失效导致整天 X 数据缺失，靠人工对账次日才发现。
 * 本工具一条命令回答「昨天的管道是否全绿跑完」：各源 changes 是否有当日记录、
 * 双日报 event 是否已发布（site 仓库 src/content/events 是否存在对应文件）。
 *
 * 用法：bun tools/2026-10-27-pipeline-gap-check/pipeline-gap-check.ts [--date 2026-10-26]
 *   --date 指定报告日（默认昨天）；changes 按运行日（报告日+1）核对。
 * 退出码：0 = 全绿；1 = 有缺口。纯本地秒级。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");
const CHANGES_DIR = path.join(DATA, "sources");

function localDay(ms: number): string {
	return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function changesCount(source: string, runDate: string): number | null {
	const f = path.join(CHANGES_DIR, source, "changes", `${runDate}.json`);
	if (!existsSync(f)) return null;
	try {
		const j = JSON.parse(readFileSync(f, "utf8")) as { added?: unknown[] };
		return Array.isArray(j.added) ? j.added.length : 0;
	} catch {
		return -1;
	}
}

function eventExists(slug: string): boolean {
	if (!existsSync(EVENTS)) return false;
	return readdirSync(EVENTS).some((f) => f.endsWith(`.${slug}.md`));
}

function main(): number {
	const argv = process.argv.slice(2);
	const idx = argv.indexOf("--date");
	const today = localDay(Date.now());
	const reportDate = idx >= 0 ? argv[idx + 1]! : localDay(Date.now() - 24 * 3600_000);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
		console.error(`--date 需 YYYY-MM-DD：${reportDate}`);
		return 1;
	}
	void today;
	const runDate = localDay(new Date(`${reportDate}T00:00:00+08:00`).getTime() + 24 * 3600_000);

	const gaps: string[] = [];
	const lines: string[] = [];
	lines.push(`报告日 ${reportDate}（运行日 ${runDate}）：`);

	// 各源 changes：commits 按 --date 报告日命名，其余源按运行日命名（脚本实际口径）
	const sources: [string, string, string][] = [
		["github-stars", "星标", runDate],
		["github-commits", "提交", reportDate],
		["github-deps", "依赖", runDate],
		["x-likes", "X 动态", runDate],
	];
	for (const [src, label, dateKey] of sources) {
		const n = changesCount(src, dateKey);
		if (n === null) {
			gaps.push(`${label} changes 缺失（${src}/changes/${dateKey}.json 不存在）`);
			lines.push(`  ${label}：✗ changes 文件缺失（${dateKey}）`);
		} else if (n < 0) {
			gaps.push(`${label} changes 解析失败`);
			lines.push(`  ${label}：✗ changes 解析失败`);
		} else {
			lines.push(`  ${label}：changes ${n} 条`);
		}
	}

	// 双日报 event（发布态）
	const slugs: [string, string][] = [
		[`github-daily-${reportDate}`, "GitHub 日报"],
		[`x-daily-${reportDate}`, "X 日报"],
	];
	for (const [slug, label] of slugs) {
		if (eventExists(slug)) lines.push(`  ${label}：已发布（${slug}）`);
		else {
			gaps.push(`${label} 未发布（缺 event ${slug}）`);
			lines.push(`  ${label}：✗ 未发布`);
		}
	}

	console.log(lines.join("\n"));
	if (gaps.length) {
		console.error(`缺口 ${gaps.length} 项：`);
		for (const g of gaps) console.error(`  - ${g}`);
		return 1;
	}
	console.log("全绿：各源有当日记录，双日报已发布");
	return 0;
}

process.exit(main());
