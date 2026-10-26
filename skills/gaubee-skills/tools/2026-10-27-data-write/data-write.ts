#!/usr/bin/env bun
/**
 * data-write — 私有数据安全写包装（治「绕过 vault 镜像」的根因）
 *
 * 背景（2026-10-26 实证）：agent 用 python/perl 直写 ~/.gaubee-skills/data 下的
 * 私有数据文件，绕过 lib.ts writeFileAtomic 的「写入即加密」镜像，vault 与工作区
 * 分叉（vault-drift-sync 只能事后补救）。本工具提供带镜像的写入通道：
 *   bun tools/2026-10-27-data-write/data-write.ts <rel-path> <src-file>
 *   cat x | bun tools/2026-10-27-data-write/data-write.ts <rel-path> -
 * rel-path 必须在 data/ 之下；写入走 writeFileAtomic（内容未变自动跳过，含 vault
 * 镜像），之后可用 vault-verify --workspace 复核。
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA_ROOT = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills");
const DATA = path.join(DATA_ROOT, "data");

function main(): number {
	const [rel, src] = process.argv.slice(2);
	if (!rel || !src) {
		console.error('用法：data-write.ts <data/下的相对路径> <src 文件 |>（stdin 用 "-"）');
		return 2;
	}
	const target = path.resolve(DATA, rel);
	if (!target.startsWith(DATA + path.sep)) {
		console.error(`拒绝：目标必须在 data/ 之下（得到 ${rel}）`);
		return 2;
	}
	const plain = src === "-" ? readFileSync(0) : readFileSync(src);

	const existed = existsSafe(target);
	const prevSize = existed ? statSync(target).size : -1;
	const changed = !existed || statSync(src === "-" ? "/dev/stdin" : src).size !== prevSize;

	const libPath = path.resolve(import.meta.dir, "..", "..", "scripts", "lib.ts");
	const { writeFileAtomic } = require(libPath) as {
		writeFileAtomic: (p: string, s: string | Uint8Array) => void;
	};
	writeFileAtomic(target, plain);
	console.log(`已写 ${path.join("data", rel)}（${plain.length} 字节；${existed ? (changed ? "覆盖" : "内容与盘上相同，镜像层自行去重") : "新建"}；vault 镜像随写入生效）`);
	return 0;
}

function existsSafe(p: string): boolean {
	try {
		statSync(p);
		return true;
	} catch {
		return false;
	}
}

process.exit(main());
