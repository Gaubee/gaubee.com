#!/usr/bin/env bun
/**
 * x-translations-export.ts — 导出未翻译条目为翻译批次块（与 x-translations-merge.ts 成对）
 *
 * 翻译增量规范化流程（cron 必做步，2026-10-10 kzf：别再让我操心）：
 *   1. bun scripts/x-translations-export.ts          # 本步：产出 /tmp/x-trans/src-NN.json
 *   2. Agent 自己翻译每个 src-NN.json（{id,text}[] → {id:译文} 写 out-NN.json，键一一对应）
 *   3. bun scripts/x-translations-export.ts --verify  # 校验 out 块键对齐后
 *      bun scripts/x-translations-merge.ts            # 合并入 translations/x-tweets.zh.json
 *   4. 重渲染受影响日期（归档生成器全量重写 + x-daily-events --force --run-date 见下）
 *
 * 选取规则：x.json 中 text 非空、translations 无该 id、原文非中文（中文原文不出 toggle，
 * 无需翻译）。输出按 50 条/块切分到 /tmp/x-trans/src-NN.json（{id,text} 数组）。
 * --dir 可改输出目录；已有 src 块默认跳过重写（幂等），--force 覆盖。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "./lib.ts";

const outDir = (() => {
  const i = process.argv.indexOf("--dir");
  return i > -1 ? process.argv[i + 1] ?? "/tmp/x-trans" : "/tmp/x-trans";
})();
const force = process.argv.includes("--force");
const verifyOnly = process.argv.includes("--verify");

const REPO = path.resolve(import.meta.dir, "..", "..", "..");
const TRANSLATIONS = path.resolve(import.meta.dir, "..", "translations", "x-tweets.zh.json");
const SRC = path.join(sourceDir("x-likes"), "x.json");

const hasCJK = (s: string): boolean => /[\u4e00-\u9fff]/.test(s);

// --verify：校验 out-NN 与 src-NN 键一一对应（merge 前置自检，不做写入）
if (verifyOnly) {
  if (!existsSync(outDir)) {
    console.log("verify ok: 批次目录不存在（无待合并块）");
    process.exit(0);
  }
  const files = readdirSync(outDir).filter((f) => /^out-\d+\.json$/.test(f)).sort();
  let bad = 0;
  for (const f of files) {
    const srcPath = path.join(outDir, f.replace("out-", "src-"));
    try {
      if (!existsSync(srcPath)) {
        // 与 merge 语义一致：缺 src 块仅警告（可能是历史残留），不阻塞
        console.warn(`WARN ${f}: 无对应 src 块，跳过`);
        continue;
      }
      const src: { id: string }[] = JSON.parse(readFileSync(srcPath, "utf8"));
      const out: Record<string, string> = JSON.parse(readFileSync(path.join(outDir, f), "utf8"));
      if (!Array.isArray(src)) throw new Error("src 块不是数组");
      const srcIds = src.map((t) => t.id).sort();
      const outIds = Object.keys(out).sort();
      const aligned = srcIds.length === outIds.length && srcIds.every((id, i) => id === outIds[i]);
      const allNonEmpty = Object.values(out).every((v) => typeof v === "string" && v.trim());
      if (!aligned || !allNonEmpty) {
        console.error(`FAIL ${f}: 键${aligned ? "对齐" : `失配 src=${srcIds.length} out=${outIds.length}`} / 值${allNonEmpty ? "非空" : "存在空串"}`);
        bad++;
      }
    } catch (e) {
      console.error(`FAIL ${f}: ${e instanceof Error ? e.message : e}`);
      bad++;
    }
  }
  console.log(bad === 0 ? `verify ok: ${files.length} 块全部键对齐且非空` : `verify failed: ${bad} 块异常`);
  process.exit(bad === 0 ? 0 : 1);
}

interface Tweet { id: string; text?: string; created_at?: string }

const store: { items: Record<string, Tweet> } = JSON.parse(readFileSync(SRC, "utf8"));
const zh: Record<string, string> = existsSync(TRANSLATIONS)
  ? JSON.parse(readFileSync(TRANSLATIONS, "utf8"))
  : {};

const missing = Object.values(store.items)
  .filter((t) => (t.text ?? "").trim() && !zh[t.id] && !hasCJK(t.text ?? ""))
  .map((t) => ({ id: t.id, text: t.text! }));

if (missing.length === 0) {
  console.log("无未翻译条目（非中文正文且缺译文的为 0），无需翻译增量");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
if (!force) {
  // 幂等：清理旧 src 块重写（out 块保留——可能是未合并的已完成翻译）
  for (const f of readdirSync(outDir)) if (/^src-\d+\.json$/.test(f)) rmSync(path.join(outDir, f));
}
const CHUNK = 50;
let n = 0;
for (let i = 0; i < missing.length; i += CHUNK) {
  n++;
  await Bun.write(path.join(outDir, `src-${String(n).padStart(2, "0")}.json`), JSON.stringify(missing.slice(i, i + CHUNK)));
}
console.log(`导出 ${missing.length} 条未翻译（非中文正文）→ ${outDir}/src-01..${String(n).padStart(2, "0")}.json（${CHUNK} 条/块）`);
console.log("下一步：Agent 翻译各块为 out-NN.json（{id:译文}，键一一对应），然后 --verify + x-translations-merge.ts");
