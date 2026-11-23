#!/usr/bin/env bun
/**
 * star-browse — 按策展分类浏览收藏（webapp）
 *
 * 背景（2026-11-24）：kzf 常问「我收藏里有哪些 X 类的东西」。stars-search 需要他先想到关键词，
 * 但真正要的是「按类目看全貌」。taxonomy 已经是人工策展的 16 个分类，
 * 投影成公开数据后可以在浏览器里直接按奶目浏览。
 *
 * 形态：webapp（只读 taxonomy 与 stars 的公开投影，纯前端算）。
 * 数据：static/tools/data/taxonomy.json + stars.json
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(process.env.HOME!, ".gaubee-skills", "data");
// 工具在 <site>/skills/gaubee-skills/tools/<slug>/，所以仓库根要上四级
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const TAXO = path.join(DATA, "taxonomy.md");
// 星数与语言只在公开投影里有（本地 stars.json 不含 stars 字段），所以优先读投影
const STARS = path.join(SITE, "static", "tools", "data", "stars.json");

interface Section {
  section: string;
  repos: string[];
}

function main(): number {
  const argv = process.argv.slice(2);
  const query = argv.find((a) => !a.startsWith("--")) ?? "";
  if (!existsSync(TAXO)) {
    console.error(`缺少 ${TAXO}`);
    return 2;
  }

  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const line of readFileSync(TAXO, "utf8").split("\n")) {
    const h = line.match(/^###\s+(.+?)（/);
    if (h) {
      if (cur && cur.repos.length) sections.push(cur);
      cur = { section: h[1]!, repos: [] };
      continue;
    }
    const m = line.match(/^- \[([\w.-]+\/[\w.-]+)\]/);
    if (m && cur) cur.repos.push(m[1]!);
  }
  if (cur && cur.repos.length) sections.push(cur);

  // 星标元数据（可选：用于显示星数与语言）
  const meta = new Map<string, { stars: number; lang: string; desc: string }>();
  if (existsSync(STARS)) {
    const j = JSON.parse(readFileSync(STARS, "utf8")) as {
      repos?: Array<{ name: string; stars: number; lang: string; desc: string }>;
    };
    for (const r of j.repos ?? []) meta.set(r.name, { stars: r.stars ?? 0, lang: r.lang ?? "", desc: r.desc ?? "" });
  }

  if (query) {
    const q = query.toLowerCase();
    const hits = sections
      .map((s) => ({
        section: s.section,
        repos: s.repos.filter((r) => {
          const m = meta.get(r);
          const hay = `${r} ${m?.desc ?? ""}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((s) => s.repos.length > 0);
    console.log(`「${query}」在 ${hits.length} 个分类里有命中：\n`);
    for (const h of hits) {
      console.log(`【${h.section}】${h.repos.length} 个`);
      for (const r of h.repos) {
        const m = meta.get(r);
        console.log(`  ${r}${m ? `  ★${m.stars} ${m.lang}` : ""}`);
        if (m?.desc) console.log(`      ${m.desc.slice(0, 80)}`);
      }
    }
    return 0;
  }

  console.log(`收藏分类浏览：${sections.length} 个分类，${sections.reduce((n, s) => n + s.repos.length, 0)} 个仓库\n`);
  for (const s of sections) {
    const totalStars = s.repos.reduce((n, r) => n + (meta.get(r)?.stars ?? 0), 0);
    console.log(`【${s.section}】${s.repos.length} 个，累计 ★${totalStars}`);
  }
  console.log("\n提示：加关键词可以按分类过滤，例如 `star-browse 视频`。");
  return 0;
}

process.exit(main());
