/**
 * move-file.ts — 单文件移动：rename 优先；跨卷（EXDEV）退化为复制后删源。
 * 用于「临时目录产出 → 迁入 staging」的两步落盘（x-video-dl / x-hls 共用）。
 */
import { copyFileSync, renameSync, rmSync } from "node:fs";

export function moveFile(src: string, dest: string): void {
	try {
		renameSync(src, dest);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
		copyFileSync(src, dest);
		rmSync(src, { force: true });
	}
}
