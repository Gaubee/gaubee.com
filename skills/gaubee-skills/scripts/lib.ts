import { renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
/**
 * lib.ts — gaubee-skills 共享基元
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：汇总多源工作信号（GitHub 星标 / 未来的 X 转发喜欢 / 每日提交记录）成活档案。
 * - 1. 路径约定：DATA/sources/<source>/ 是每个源的分区根
 * - 2. 本地日期工具（报告/快照/变更一律本地时区）
 * - 3. github-stars 的快照类型（其它源未来自带类型）
 * - [2026-10-05] 迁移裁决（kzf）：本 skill 迁入 gaubee.com 仓库（skills/gaubee-skills/）。
 *   隐私边界：代码/法则/报告进仓库；含私有信号的数据（sources、本地图谱、profile、
 *   research）与凭据（.env）一律在仓库外 DATA_ROOT（默认 ~/.gaubee-skills，可用
 *   GAUBEE_SKILLS_DATA 覆盖）。数据目录绝不进 git。
 */
import path from "node:path";

/** skill 根（gaubee.com 仓库内）：代码、写作法则、报告 */
export const ROOT = path.resolve(import.meta.dir, "..");
/** 私有数据根（仓库外）：sources 私有信号源、本地 tech-graph、profile、research、.env */
export const DATA_ROOT = process.env.GAUBEE_SKILLS_DATA ?? path.join(homedir(), ".gaubee-skills");
export const DATA = path.join(DATA_ROOT, "data");

/** 数据源分区根：DATA/sources/<source>/ */
export const sourceDir = (source: string) => path.join(DATA, "sources", source);

/** 原子写：先写 .tmp 再 rename，避免并发读取撕裂（2026-10-03 复核建议） */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** 本地时区日期（YYYY-MM-DD）——不用 UTC，避免午夜附近错日 */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** github-stars 源的单条星标记录 */
export interface StarRepo {
  full_name: string;
  html_url: string;
  description: string;
  homepage: string;
  language: string;
  topics: string[];
  stars: number;
  pushed_at: string;
  archived: boolean;
  starred_at: string; // YYYY-MM-DD；缺失时置 "1970-01-01"（time=0 约定，kzf 2026-10-04）
  order: number; // 收藏序号：1 = 最早，N = 最新；时间缺失/同秒并列时的稳定排序键
}

export interface Snapshot {
  fetched_at: string;
  user: string;
  count: number;
  repos: StarRepo[];
}
