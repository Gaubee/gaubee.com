/**
 * x-rerender.ts — 按本地日重渲染 X 事件（x.json 媒体键事后变更的工具共用）。
 *
 * 规则与 cron 口径一致：
 * - 有策展日报（`*.x-daily-<日>.md`）的日期：`x-daily-events.ts --date D --run-date D+1 --force`
 *   ——run-date 按「次日报昨日」规则取报告日+1，R8 日期锚定不随操作日漂移；
 * - 其余日期交 `x-archive-events.ts` 全量重写（已被日报覆盖的日期自动跳过）。
 * 调用方：tools/2026-10-20-video-retro-hd（videoLocal 改 HLS 键）、
 *         tools/2026-10-20-x-posters-backfill（posterLocal 接线）。
 */
import { readdirSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SKILL = path.resolve(import.meta.dir, "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");

/** 本地日（Asia/Shanghai，与生成器 sv-SE 口径一致） */
export function localDay(iso: string): string {
	return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function run(label: string, args: string[]): void {
	const r = Bun.spawnSync(["bun", ...args], { stdout: "ignore", stderr: "pipe" });
	const tail = r.exitCode === 0 ? "" : `｜${new TextDecoder().decode(r.stderr).trim().split("\n").pop()?.slice(0, 160) ?? ""}`;
	console.error(`  ${label}：exit ${r.exitCode}${tail}`);
}

/** 重渲染给定本地日集合；空集合直接返回。退出码逐条打印，不抛错（由调用方决定收据语义）。 */
export function rerenderDays(days: Iterable<string>): void {
	const sorted = [...new Set(days)].sort();
	if (sorted.length === 0) return;
	const names = readdirSync(EVENTS);
	for (const day of sorted) {
		if (!names.some((n) => n.endsWith(`.x-daily-${day}.md`))) continue;
		const next = new Date(`${day}T00:00:00+08:00`);
		next.setUTCDate(next.getUTCDate() + 1);
		const runDate = localDay(next.toISOString());
		run(`重渲染日报 ${day}（run-date ${runDate}）`, [path.join(SKILL, "scripts", "x-daily-events.ts"), "--date", day, "--run-date", runDate, "--force"]);
	}
	run("归档全量重写（已覆盖日自动跳过）", [path.join(SKILL, "scripts", "x-archive-events.ts")]);
}
