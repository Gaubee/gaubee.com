/**
 * 合并翻译批次的产出到 translations/x-tweets.zh.json
 *
 * 用法：
 *   1. 用导出脚本把未翻译条目分块到 /tmp/x-trans/src-NN.json（{id,text} 数组）
 *   2. 子代理翻译后产出 /tmp/x-trans/out-NN.json（{id: 译文} 对象）
 *   3. bun skills/gaubee-skills/scripts/x-translations-merge.ts [--dir /tmp/x-trans]
 *
 * 校验：键一一对应（不得增删）、值为非空字符串；缺块仅警告不阻塞。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = (() => {
  const i = process.argv.indexOf("--dir");
  return i > -1 ? process.argv[i + 1] ?? "/tmp/x-trans" : "/tmp/x-trans";
})();

const TRANSLATIONS = path.join(import.meta.dir, "..", "translations", "x-tweets.zh.json");
const zh: Record<string, string> = JSON.parse(readFileSync(TRANSLATIONS, "utf8"));
const before = Object.keys(zh).length;

const files = readdirSync(dir)
  .filter((f) => /^out-\d+\.json$/.test(f))
  .sort();

let added = 0;
let skipped: string[] = [];
for (const f of files) {
  const srcFile = path.join(dir, f.replace("out-", "src-"));
  const src: { id: string }[] = JSON.parse(readFileSync(srcFile, "utf8"));
  const out: Record<string, string> = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const srcIds = new Set(src.map((s) => s.id));
  for (const [id, text] of Object.entries(out)) {
    if (!srcIds.has(id)) {
      skipped.push(`${f}: 未知键 ${id}`);
      continue;
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      skipped.push(`${f}: 空译文 ${id}`);
      continue;
    }
    if (!zh[id]) added++;
    zh[id] = text;
  }
  const missing = src.filter((s) => !(s.id in out)).length;
  if (missing) skipped.push(`${f}: 缺 ${missing} 条`);
}

await Bun.write(TRANSLATIONS, JSON.stringify(zh, null, 2) + "\n");
console.log(`merged: +${added} (total ${before} -> ${Object.keys(zh).length})`);
if (skipped.length) console.log("issues:\n" + skipped.map((s) => "  - " + s).join("\n"));
