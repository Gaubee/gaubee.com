#!/usr/bin/env bun
/**
 * x-media-audit.ts — X 档案媒体库对账（gaubee-skills 工具工坊提案，2026-10-05；
 * cdn-media Phase 3 重写 2026-10-07：对账对象从「磁盘 static/x-media」改为
 * 「cdn-media manifest + staging」，旧 100MB git push 门禁随「媒体不进 git」一并废除）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] 原始需求（kzf）：媒体库一致性此前只能靠肉眼，需要一条命令完成对账。
 * - [2026-10-07 Phase 3（plan 3.3）] 新数据形态：媒体权威存放 = GitHub Releases 卷
 *   （manifest-<gen>.json 对象集）；本地增量 = cdn-media/staging/x/（canonical key 布局，
 *   抓取管道落点，打包发布后按 7 天保留期清理）；x.json 的 mediaLocal/videoLocal/
 *   posterLocal = canonical media key `cdn-media/x/<月>/<文件>`（不再兼任磁盘路径）。
 * - 1. 引用完整性：x.json 引用 ⊆ manifest 对象集（缺失且 staging 也无 → 断链，硬门禁）
 * - 2. staging 状态：待打包（不在 manifest，patch 候选）/ 待清理（已在 manifest，
 *   7 天保留期）/ 孤儿（不在 manifest 且无任何条目引用 → 硬门禁）
 * - 3. 本地化覆盖：按图片/视频侧统计「有远程 URL 无本地引用」条目
 * - 4. 门禁语义：断链/孤儿任一硬问题退出码 1，否则 0（可挂日常维护流程）
 * - 5. [2026-10-07 r13 P1-2] `--require-packed` 硬门旗标：开启时「待打包 awaitingPack」
 *   也视为失败退出非零——供日报生成等下游流程作前置 gate（引用已 stage 但未入卷
 *   就是会 404 的断链，诊断模式不受影响：默认行为不变，仍退出 0）
 *
 * 运行：bun tools/2026-10-05-x-media-audit/x-media-audit.ts [--top N] [--require-packed]
 * 前置：x.json 已由 x-archive-import / x-likes-fetch 建立；manifest 在
 * GAUBEE_SITE（缺省仓库根）/cdn-media/manifest；staging 在 cdn-media/staging/x
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const MANIFEST_DIR = path.join(SITE, "cdn-media", "manifest");
const STAGING_X = path.join(SITE, "cdn-media", "staging", "x");

interface Tweet {
	id: string;
	kind: string;
	media?: string[];
	video?: string[];
	/** canonical media key：cdn-media/x/<月>/<文件>（Phase 3 冻结语义） */
	mediaLocal?: string[];
	videoLocal?: string[];
	posterLocal?: string;
	synChecked?: boolean;
}
interface XStore {
	items: Record<string, Tweet>;
}

function fmtBytes(n: number): string {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${n} B`;
}

/** Dirent 手递归扫盘（零依赖）；返回绝对路径与字节数。目录不存在按空库处理。 */
function walkFiles(root: string): { abs: string; size: number }[] {
	const out: { abs: string; size: number }[] = [];
	const stack: string[] = [root];
	while (stack.length) {
		const dir = stack.pop()!;
		let ents;
		try {
			ents = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const ent of ents) {
			const abs = path.join(dir, ent.name);
			if (ent.isDirectory()) stack.push(abs);
			else if (ent.isFile()) out.push({ abs, size: statSync(abs).size });
		}
	}
	return out;
}

/** manifest 权威对象集：Set<"x/<月>/<文件>">（canonical key 去 cdn-media/ 前缀形态）
 *  在 async main 内联加载（零网络，读本地仓库副本）。 */

async function main() {
	const args = process.argv.slice(2);
	let top = 10;
	const topIdx = args.indexOf("--top");
	if (topIdx >= 0) top = Number.parseInt(args[topIdx + 1] ?? "", 10) || 10;
	// r13 P1-2：--require-packed 硬门——awaitingPack > 0 也退出非零（日报生成等
	// 下游流程的前置 gate）；默认（诊断模式）不受影响，待打包仍只提示。
	const requirePacked = args.includes("--require-packed");

	const store: XStore = JSON.parse(
		await Bun.file(path.join(sourceDir("x-likes"), "x.json")).text(),
	);
	const items = Object.values(store.items);

	// —— manifest 权威对象集（gen → manifest-<gen>.json；本地仓库副本，零网络） ——
	const manifestKeys = new Set<string>();
	let manifestGen = 0;
	let manifestBytes = 0;
	const currentFile = path.join(MANIFEST_DIR, "current.json");
	if (existsSync(currentFile)) {
		const current = JSON.parse(await Bun.file(currentFile).text()) as { gen?: number };
		manifestGen = current.gen ?? 0;
		const manifest = JSON.parse(
			await Bun.file(path.join(MANIFEST_DIR, `manifest-${manifestGen}.json`)).text(),
		) as { objects?: { key?: string; size?: number }[] };
		for (const o of manifest.objects ?? []) {
			if (typeof o.key === "string") manifestKeys.add(o.key);
			manifestBytes += o.size ?? 0;
		}
	}

	// —— 引用面：canonical key 声明 + 远程未本地化缺口 ——
	const refs = new Map<string, string>(); // canonical key → tweet id
	const kindCount = new Map<string, number>();
	let pending = 0;
	let noLocalMedia = 0;
	let noLocalVideo = 0;
	for (const t of items) {
		kindCount.set(t.kind, (kindCount.get(t.kind) ?? 0) + 1);
		if (!t.synChecked) pending++;
		for (const rel of t.mediaLocal ?? []) if (!refs.has(rel)) refs.set(rel, t.id);
		for (const rel of t.videoLocal ?? []) if (!refs.has(rel)) refs.set(rel, t.id);
		if (t.posterLocal && !refs.has(t.posterLocal)) refs.set(t.posterLocal, t.id);
		if (t.media?.length && !t.mediaLocal?.length) noLocalMedia++;
		if (t.video?.length && !t.videoLocal?.length) noLocalVideo++;
	}
	const kindLine = [...kindCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `${k} ${n}`)
		.join(" · ");

	// —— staging 面：canonical key（x/<月>/<文件>）→ 字节数 ——
	// 扫描根 = staging/x，相对路径是 <月>/<文件>；manifest 键带 x/ 前缀，此处统一归一
	const staging = new Map<string, number>();
	for (const f of walkFiles(STAGING_X)) {
		staging.set(`x/${path.relative(STAGING_X, f.abs)}`, f.size);
	}

	// —— 对账 1：引用完整性（引用缺失 = 既不在 manifest、staging 也无本地副本） ——
	const broken: string[] = []; // 断链（硬门禁）
	const awaitingPack: string[] = []; // staging 有副本、待 --patch 入卷
	for (const rel of refs.keys()) {
		const key = rel.startsWith("cdn-media/") ? rel.slice("cdn-media/".length) : rel;
		if (manifestKeys.has(key)) continue;
		if (staging.has(key)) awaitingPack.push(rel);
		else broken.push(rel);
	}

	// —— 对账 2：staging 状态 ——
	const cleanup: string[] = []; // 已在 manifest（7 天保留期清理候选）
	const orphan: string[] = []; // 无 manifest 记录且无条目引用（硬门禁）
	for (const [key] of staging) {
		if (manifestKeys.has(key)) {
			cleanup.push(key);
			continue;
		}
		const canonical = `cdn-media/${key}`;
		if (refs.has(canonical)) continue; // 待打包（awaitingPack 已统计）
		orphan.push(key);
	}

	// —— 体积构成 ——
	const stagingPending = [...staging.entries()].filter(
		([k]) => !manifestKeys.has(k) && refs.has(`cdn-media/${k}`),
	);
	const stagingPendingBytes = stagingPending.reduce((s, [, b]) => s + b, 0);
	const cleanupBytes = cleanup.reduce((s, k) => s + (staging.get(k) ?? 0), 0);
	const isVideoKey = (k: string) => k.endsWith(".mp4");
	const manifestVideo = [...manifestKeys].filter(isVideoKey).length;

	// —— 报告 ——
	const lines: string[] = [];
	lines.push("# X 媒体库对账（manifest + staging，Phase 3 语义）");
	lines.push(
		`库存 ${items.length} 条动态（${kindLine}）· 待回灌 ${pending} 条`,
	);
	lines.push(
		`本地引用：图片条目 ${[...refs.keys()].filter((r) => !isVideoKey(r)).length} · 视频条目 ${[...refs.keys()].filter(isVideoKey).length} ｜ 远程未本地化：图片 ${noLocalMedia} · 视频 ${noLocalVideo}`,
	);
	lines.push(
		`manifest gen ${manifestGen}：${manifestKeys.size} 对象 · ${fmtBytes(manifestBytes)}（视频 ${manifestVideo}）`,
	);
	lines.push(
		`staging：${staging.size} 文件（待打包 ${stagingPending.length} · ${fmtBytes(stagingPendingBytes)}；待清理 ${cleanup.length} · ${fmtBytes(cleanupBytes)}，发布校验通过后 7 天）`,
	);
	lines.push("");
	lines.push(
		`引用完整性：断链 ${broken.length}${broken.length ? " ✗" : " ✓"}（缺失且 staging 无副本）｜ 待打包引用 ${awaitingPack.length}${awaitingPack.length ? "（--patch 入卷后收敛）" : ""}`,
	);
	lines.push(
		`staging 一致性：孤儿 ${orphan.length}${orphan.length ? " ✗（无引用无 manifest，核对后删除）" : " ✓"}`,
	);
	lines.push(
		`本地化覆盖：${noLocalMedia + noLocalVideo === 0 ? "全量已本地化 ✓" : `缺口 ${noLocalMedia + noLocalVideo} 条（图片侧 ${noLocalMedia} · 视频侧 ${noLocalVideo}）`}`,
	);

	if (broken.length) {
		lines.push("");
		lines.push(`## 断链引用（x.json 声明但 manifest 与 staging 均无）${broken.length} 个`);
		for (const rel of broken.slice(0, top)) lines.push(`- ${rel} ← ${refs.get(rel)}`);
		if (broken.length > top) lines.push(`- … 共 ${broken.length} 个`);
	}
	if (orphan.length) {
		lines.push("");
		lines.push(`## staging 孤儿（无 manifest 记录且无条目引用）${orphan.length} 个`);
		for (const k of orphan.slice(0, top)) lines.push(`- ${k}`);
		if (orphan.length > top) lines.push(`- … 共 ${orphan.length} 个`);
	}
	if (awaitingPack.length) {
		lines.push("");
		lines.push(`## 待打包（staging 有副本，未入卷）${awaitingPack.length} 个`);
		for (const rel of awaitingPack.slice(0, top)) lines.push(`- ${rel}`);
		if (awaitingPack.length > top) lines.push(`- … 共 ${awaitingPack.length} 个`);
	}
	if (cleanup.length) {
		lines.push("");
		lines.push(`## staging 待清理（已入卷，7 天保留期内）${cleanup.length} 个 · ${fmtBytes(cleanupBytes)}`);
		for (const k of cleanup.slice(0, top)) lines.push(`- ${k}`);
		if (cleanup.length > top) lines.push(`- … 共 ${cleanup.length} 个`);
	}

	console.log(lines.join("\n"));
	// 门禁：硬问题（断链/孤儿）才失败；待打包/待清理/缺口只提示。
	// r13 P1-2：--require-packed 开启时，待打包引用（已 stage 未入卷 = 对外 404）
	// 升级为硬失败——日报生成前的硬 gate，堵住「staging 引用未入 manifest 仍放行」。
	const hardFail = broken.length > 0 || orphan.length > 0 || (requirePacked && awaitingPack.length > 0);
	if (hardFail) {
		if (requirePacked && awaitingPack.length > 0) {
			console.error(
				`[require-packed] 待打包引用 ${awaitingPack.length} 个未入卷（对站点即 404）——` +
					`先跑 media-pack --patch + --publish 入卷再生成日报`,
			);
		}
		process.exit(1);
	}
}

await main();
