#!/usr/bin/env bun
/**
 * stale-out-guard — 检查 /tmp 里残留的译文批次会不会覆盖已合并的译文
 *
 * 背景（2026-11-22 实证）：`x-translations-merge.ts` 会把 `/tmp/x-trans/out-*.json` 里的值
 * 写回翻译库。批次文件用完后没人清理，于是下一次 finalize 又会把它们合并一遍——
 * 如果中间手工修过某条译文（那次是把「图像模型」改掉，避开比喻检测器的误判），
 * 就会被旧值覆盖回去，而且没有任何提示。
 *
 * 本工具对比每个 out 批次与当前翻译库：
 *   - 值相同 → 安全（重复合并无影响）
 *   - 值不同 → 危险（下次合并会覆盖现有译文）
 *   - 键不存在 → 新增（正常，合并后会补上）
 *
 * 用法：
 *   bun tools/2026-11-22-stale-out-guard/stale-out-guard.ts
 *   bun tools/2026-11-22-stale-out-guard/stale-out-guard.ts --dir /tmp/x-trans --archive
 * 退出码：0 = 无冲突；1 = 有会被覆盖的键；2 = 路径异常。--archive 会把冲突批次移到 merged/。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";

const SKILL = path.resolve(import.meta.dir, "..", "..");
const TRANS = path.join(SKILL, "translations", "x-tweets.zh.json");

interface Conflict {
  file: string;
  id: string;
  current: string;
  stale: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--dir");
  const dir = di >= 0 ? argv[di + 1]! : "/tmp/x-trans";
  const archive = argv.includes("--archive");
  if (!existsSync(dir)) {
    console.log(`没有批次目录 ${dir}（说明今天还没导出译文）`);
    return 0;
  }
  if (!existsSync(TRANS)) {
    console.error(`缺少翻译库：${TRANS}`);
    return 2;
  }
  const merged = JSON.parse(readFileSync(TRANS, "utf8")) as Record<string, string>;
  const outs = readdirSync(dir).filter((f) => /^out-\d+\.json$/.test(f));
  if (outs.length === 0) {
    console.log(`批次目录 ${dir} 里没有 out-*.json`);
    return 0;
  }

  const conflicts: Conflict[] = [];
  let additions = 0;
  let same = 0;
  for (const f of outs) {
    let batch: Record<string, string>;
    try {
      batch = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Record<string, string>;
    } catch {
      console.log(`  ! ${f} 解析失败，跳过`);
      continue;
    }
    for (const [id, val] of Object.entries(batch)) {
      const cur = merged[id];
      if (cur === undefined) additions++;
      else if (cur === val) same++;
      else conflicts.push({ file: f, id, current: cur, stale: val });
    }
  }

  console.log(`批次文件 ${outs.length} 个：相同 ${same}、新增 ${additions}、冲突 ${conflicts.length}`);
  if (conflicts.length === 0) {
    console.log("STALE OUT OK：残留批次不会改变现有译文");
    return 0;
  }
  for (const c of conflicts.slice(0, 10)) {
    console.log(`  ✗ ${c.file} ${c.id}`);
    console.log(`      现译文：${c.current.slice(0, 40)}`);
    console.log(`      批次值：${c.stale.slice(0, 40)}`);
  }
  if (conflicts.length > 10) console.log(`  …另 ${conflicts.length - 10} 条`);

  if (archive) {
    const dest = path.join(dir, "merged");
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    for (const f of new Set(conflicts.map((c) => c.file))) {
      renameSync(path.join(dir, f), path.join(dest, `${Date.now()}-${f}`));
      console.log(`  已归档 ${f} → merged/`);
    }
  } else {
    console.log("\n建议：确认批次是旧的之后跑 --archive，或手工删掉这些 out 文件。");
  }
  return 1;
}

process.exit(main());
