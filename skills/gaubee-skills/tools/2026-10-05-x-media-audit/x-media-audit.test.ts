// x-media-audit --require-packed 最小夹具验证（r13 P1-2）
//   bun test tools/2026-10-05-x-media-audit/x-media-audit.test.ts
//
// 覆盖（gate 语义）：
// - awaitingPack > 0 时默认（诊断模式）退出 0——行为不回归
// - awaitingPack > 0 时加 --require-packed 退出非零（日报生成前置硬门）
// - awaitingPack = 0 时 --require-packed 不误伤（退出 0）
// - 断链（broken）在两种模式下都退出非零（原有硬门不回归）
//
// 夹具全走环境变量隔离：GAUBEE_SITE 指向假站点根（cdn-media/manifest + staging/x）、
// GAUBEE_SKILLS_DATA 指向假数据根（sources/x-likes/x.json）。全部 id/键名为假值，
// 不触真实仓库与真实数据。

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const SCRIPT = path.resolve(import.meta.dir, "x-media-audit.ts");

type RunResult = { code: number; stdout: string; stderr: string };

// 造一套隔离夹具（site 根 + 数据根），返回 spawn 用 env
function makeFixture(opts: { stagedRef: boolean; brokenRef: boolean }): { env: Record<string, string>; root: string } {
	const root = mkdtempSync(path.join("/tmp", "x-audit-fixture-"));
	const site = path.join(root, "site");
	const data = path.join(root, "data");
	const manifestDir = path.join(site, "cdn-media", "manifest");
	const stagingMonth = path.join(site, "cdn-media", "staging", "x", "2026-01");
	const sourceDir = path.join(data, "sources", "x-likes");
	for (const d of [manifestDir, stagingMonth, sourceDir]) mkdirSync(d, { recursive: true });

	// manifest gen 1：只收录 packed.jpg
	writeFileSync(
		path.join(manifestDir, "current.json"),
		JSON.stringify({ gen: 1 }) + "\n",
	);
	writeFileSync(
		path.join(manifestDir, "manifest-1.json"),
		JSON.stringify({ objects: [{ key: "x/2026-01/packed.jpg", size: 5 }] }) + "\n",
	);
	// staging：packed.jpg（已入卷）+ 可选 staged.jpg（未入卷）
	writeFileSync(path.join(stagingMonth, "packed.jpg"), Buffer.from("packed"));
	if (opts.stagedRef) writeFileSync(path.join(stagingMonth, "staged.jpg"), Buffer.from("staged"));

	// x.json：引用面
	const items: Record<string, unknown> = {
		"111": { id: "111", kind: "posted", mediaLocal: ["cdn-media/x/2026-01/packed.jpg"] },
	};
	if (opts.stagedRef) items["222"] = { id: "222", kind: "posted", mediaLocal: ["cdn-media/x/2026-01/staged.jpg"] };
	if (opts.brokenRef) items["333"] = { id: "333", kind: "posted", mediaLocal: ["cdn-media/x/2026-01/missing.jpg"] };
	writeFileSync(path.join(sourceDir, "x.json"), JSON.stringify({ items }) + "\n");

	// GAUBEE_SKILLS_DATA 是私有数据根（lib.ts 会拼 data/sources/…），指向 root 本身
	return { root, env: { ...process.env, GAUBEE_SITE: site, GAUBEE_SKILLS_DATA: root } as Record<string, string> };
}

function runAudit(env: Record<string, string>, extraArgs: string[] = []): RunResult {
	const r = Bun.spawnSync(["bun", SCRIPT, ...extraArgs], { env, stdout: "pipe", stderr: "pipe" });
	return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

describe("x-media-audit --require-packed（r13 P1-2）", () => {
	test("awaitingPack>0：默认诊断模式退出 0（行为不回归），报告保留待打包列表", () => {
		const fx = makeFixture({ stagedRef: true, brokenRef: false });
		try {
			const r = runAudit(fx.env);
			expect(r.code).toBe(0);
			expect(r.stdout).toContain("待打包 1");
			expect(r.stdout).toContain("x/2026-01/staged.jpg");
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	});

	test("awaitingPack>0：--require-packed 退出非零并给出入卷指引", () => {
		const fx = makeFixture({ stagedRef: true, brokenRef: false });
		try {
			const r = runAudit(fx.env, ["--require-packed"]);
			expect(r.code).not.toBe(0);
			expect(r.stderr).toContain("[require-packed]");
			expect(r.stderr).toContain("media-pack");
			expect(r.stdout).toContain("待打包 1");
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	});

	test("awaitingPack=0：--require-packed 不误伤（退出 0）", () => {
		const fx = makeFixture({ stagedRef: false, brokenRef: false });
		try {
			expect(runAudit(fx.env).code).toBe(0);
			expect(runAudit(fx.env, ["--require-packed"]).code).toBe(0);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	});

	test("断链：加不加 --require-packed 都退出非零（原有硬门不回归）", () => {
		const fx = makeFixture({ stagedRef: false, brokenRef: true });
		try {
			expect(runAudit(fx.env).code).not.toBe(0);
			expect(runAudit(fx.env, ["--require-packed"]).code).not.toBe(0);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	});
});
