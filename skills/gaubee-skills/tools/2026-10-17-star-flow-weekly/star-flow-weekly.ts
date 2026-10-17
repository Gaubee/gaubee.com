// star-flow-weekly.ts — 星标兴趣周流向（工坊 2026-10-17 提案 1）
//
// 动机：每周一的周报「主题聚类」靠人肉翻 7 天 skeleton；taxonomy 已有 20 个分类，
// catalog 有全量落位，缺的只是按周窗口聚合。本工具把过去 N 天的星标按 taxonomy
// 分类聚合，输出「本周兴趣流向」（分类 × 增量排行 + 明细），供周报分析直接引用。
//
// 口径：以 stars.json 的 starred_at 归窗（行为时间），分类映射以 catalog.md 的
// 「分类标题 → repo 清单」为准（catalog 由 categorize --build-catalog 生成，标签跟
// 脚本走）。窗口缺省 = 最近 7 个自然日（含今天，便于周一覆盖上一个完整周）。
//
// 用法: bun tools/2026-10-17-star-flow-weekly/star-flow-weekly.ts [--days 7]
// 退出码：0 = 正常；1 = 数据缺失。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = new URL("../../../../../../../.gaubee-skills/data", import.meta.url).pathname;
const STARS = join(DATA, "sources/github-stars");

function argDays(): number {
  const i = process.argv.indexOf("--days");
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(v) && v > 0 ? v : 7;
}
const days = argDays();

// catalog.md 解析：### 分类（N） 后跟 - [owner/name](url) 行
const catalog = readFileSync(join(STARS, "catalog.md"), "utf8");
const repoCategory = new Map<string, string>();
let current = "";
for (const line of catalog.split("\n")) {
  const h = line.match(/^#{2,3} (.+?)（\d+/);
  if (h) {
    current = h[1]!;
    continue;
  }
  const r = line.match(/^- \[([^\]]+)\]/);
  if (r && current && current !== "未分类") repoCategory.set(r[1]!, current);
}

const stars = JSON.parse(readFileSync(join(STARS, "stars.json"), "utf8")) as {
  repos?: { full_name?: string; starred_at?: string }[];
};
type Star = { full_name: string; starred_at: string };
const list: Star[] = (stars.repos ?? (stars as unknown as Star[]))
  .map((s) => ({ full_name: String(s.full_name ?? ""), starred_at: String(s.starred_at ?? "") }));

// 窗口：今天（本地时区）往前 days-1 天的 00:00 起
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
const inWindow = list.filter((s) => s.starred_at && new Date(s.starred_at) >= start);
if (inWindow.length === 0) {
  console.log(`star-flow：最近 ${days} 天（自 ${start.toISOString().slice(0, 10)}）无星标增量`);
  process.exit(0);
}

const byCategory = new Map<string, string[]>();
for (const s of inWindow) {
  const cat = repoCategory.get(s.full_name) ?? "未分类";
  const arr = byCategory.get(cat) ?? [];
  arr.push(`${s.full_name}（${s.starred_at.slice(0, 10)}）`);
  byCategory.set(cat, arr);
}
console.log(`星标流向：最近 ${days} 天共 ${inWindow.length} 颗（自 ${start.toISOString().slice(0, 10)}）`);
for (const [cat, repos] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${cat}（+${repos.length}）`);
  for (const r of repos) console.log(`  - ${r}`);
}
const uncategorized = byCategory.get("未分类")?.length ?? 0;
if (uncategorized > 0) console.log(`\n提示：未分类 ${uncategorized} 颗待人工归入（suggest 已给建议）。`);
void readdirSync;
