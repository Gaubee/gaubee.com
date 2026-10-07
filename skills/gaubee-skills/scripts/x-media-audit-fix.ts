#!/usr/bin/env bun
/**
 * x-media-audit-fix.ts — 媒体引用体检修复：库存声明的 mediaLocal/videoLocal/posterLocal
 * （canonical media key `cdn-media/x/<月>/<文件>`，Phase 3 冻结语义）与
 * 「manifest 对象集 ∪ staging 磁盘」对账；缺失的尝试从库存远程 URL 重下载到 staging
 * （canonical key 布局，后续 media-pack --patch 入卷），仍失败则剥除引用（消灭断链）。
 *
 * Phase 3 变化（cdn-media-bootstrap plan 3.3）：存在性判定从「static/x-media 磁盘」
 * 改为「manifest（已发布权威）∪ staging（本地增量）」；重下载落点 = staging；不再有
 * 本地整库副本——manifest 是权威，staging 只是待打包缓冲。
 *
 * 运行：bun scripts/x-media-audit-fix.ts
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const MANIFEST_DIR = path.join(SITE, "cdn-media", "manifest");
const STAGING_X = path.join(SITE, "cdn-media", "staging", "x");
const UA = "Mozilla/5.0 gaubee-skills";

interface Tweet {
	id: string;
	author?: string;
	created_at: string;
	media?: string[];
	video?: string[];
	/** canonical media key：cdn-media/x/<月>/<文件> */
	mediaLocal?: string[];
	videoLocal?: string[];
	posterLocal?: string;
}

/** manifest 对象集（"x/<月>/<文件>" 形态）；读本地仓库副本，零网络 */
async function manifestKeys(): Promise<Set<string>> {
	const keys = new Set<string>();
	const currentFile = path.join(MANIFEST_DIR, "current.json");
	if (!existsSync(currentFile)) return keys;
	const current = JSON.parse(await Bun.file(currentFile).text()) as { gen?: number };
	const manifest = JSON.parse(
		await Bun.file(path.join(MANIFEST_DIR, `manifest-${current.gen}.json`)).text(),
	) as { objects?: { key?: string }[] };
	for (const o of manifest.objects ?? []) if (typeof o.key === "string") keys.add(o.key);
	return keys;
}

/** canonical key 的本地副本是否可用：已入 manifest（权威有）或 staging 有文件（待打包）。
 *  staging 扫描根 = staging/x，磁盘相对路径无 x/ 前缀，此处剥掉。 */
function localCopyAvailable(key: string, manifest: Set<string>): boolean {
	const rel = key.startsWith("cdn-media/") ? key.slice("cdn-media/".length) : key;
	if (manifest.has(rel)) return true;
	return existsSync(path.join(STAGING_X, rel.replace(/^x\//, "")));
}

/** 下载到 staging 的 canonical key 落点（staging/x/<月>/<文件>） */
async function downloadToStaging(url: string, key: string): Promise<boolean> {
	try {
		const res = await fetch(url, { headers: { "User-Agent": UA } });
		if (!res.ok) return false;
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf.length < 2000) return false;
		const rel = key.startsWith("cdn-media/") ? key.slice("cdn-media/".length) : key;
		const abs = path.join(STAGING_X, rel.replace(/^x\//, ""));
		await Bun.write(abs, buf);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const storeFile = path.join(SRC, "x.json");
	const store: { items: Record<string, Tweet> } = JSON.parse(await Bun.file(storeFile).text());
	const manifest = await manifestKeys();

	let missing = 0;
	let redownloaded = 0;
	let stripped = 0;

	for (const t of Object.values(store.items)) {
		// 图片引用对账（media[i] ↔ mediaLocal[i] 按位对应，重下载按位取 URL）
		if (t.mediaLocal?.length) {
			const kept: string[] = [];
			for (let i = 0; i < t.mediaLocal.length; i++) {
				const key = t.mediaLocal[i]!;
				if (localCopyAvailable(key, manifest)) {
					kept.push(key);
					continue;
				}
				missing++;
				const url = t.media?.[i];
				if (url && (await downloadToStaging(url, key))) {
					kept.push(key);
					redownloaded++;
				} else {
					stripped++;
				}
			}
			t.mediaLocal = kept.length ? kept : undefined;
		}

		// 视频对账（视频侧只有一条；URL 取 video[0]）
		if (t.videoLocal?.length) {
			const kept: string[] = [];
			for (const key of t.videoLocal) {
				if (localCopyAvailable(key, manifest)) {
					kept.push(key);
					continue;
				}
				missing++;
				const url = t.video?.[0];
				if (url && (await downloadToStaging(url, key))) {
					kept.push(key);
					redownloaded++;
				} else {
					stripped++;
				}
			}
			t.videoLocal = kept.length ? kept : undefined;
		}

		// 封面对账（缺失直接剥除，不阻塞视频——封面无持久远程 URL 字段可回填）
		if (t.posterLocal && !localCopyAvailable(t.posterLocal, manifest)) {
			missing++;
			t.posterLocal = undefined;
			stripped++;
		}
	}

	writeFileAtomic(storeFile, JSON.stringify(store, null, 1));
	console.error(
		`对账完成：缺失引用 ${missing}，重下载到 staging ${redownloaded}，剥除 ${stripped}（死链已消灭；重下载件待 media-pack --patch 入卷）`,
	);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
