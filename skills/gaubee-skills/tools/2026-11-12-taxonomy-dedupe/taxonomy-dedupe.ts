#!/usr/bin/env bun
/**
 * taxonomy-dedupe — 策展分类里的重复仓库条目体检
 *
 * 星标分类是人工策展的，同一个仓库被插两次时有发生（2026-11-12 首跑抓到：
 * aimod-cc/Agent2API 在同一分类里出现两行；deeplethe/solid-glass 同时挂在
 * 「AI Agent」与「前端框架」两个分类）。同一分类内重复是硬错（双计数、检索噪声），
 * 跨分类重复是提示（需要人工决定它的家）。
 *
 * 用法：
 *   bun tools/2026-11-12-taxonomy-dedupe/taxonomy-dedupe.ts
 *   bun tools/2026-11-12-taxonomy-dedupe/taxonomy-dedupe.ts --fix   # 删同分类内后出现的重复行
 * 退出码：0 = 无硬错（--fix 后仍跨分类重复也算 0）；1 = 有同分类重复；2 = 文件缺失。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const TAXONOMY = path.join(DATA, "taxonomy.md");
const LIB = path.resolve(import.meta.dir, "..", "..", "scripts", "lib.ts");

interface Entry {
  line: number;
  repo: string;
  section: string;
  text: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const fix = argv.includes("--fix");
  if (!existsSync(TAXONOMY)) {
    console.error(`taxonomy 缺失：${TAXONOMY}`);
    return 2;
  }
  const lines = readFileSync(TAXONOMY, "utf8").split("\n");
  const entries: Entry[] = [];
  let section = "";
  lines.forEach((line, i) => {
    const h = line.match(/^### (.+?)[（(]\d+[）)]\s*$/);
    if (h) {
      section = h[1]!.trim();
      return;
    }
    const m = line.match(/^- \[([^\]]+)\]\(https:\/\/github\.com\//);
    if (m && section) entries.push({ line: i, repo: m[1]!, section, text: line });
  });

  const byRepo = new Map<string, Entry[]>();
  for (const e of entries) byRepo.set(e.repo, [...(byRepo.get(e.repo) ?? []), e]);
  const dupSame: { repo: string; entries: Entry[] }[] = [];
  const dupCross: { repo: string; entries: Entry[] }[] = [];
  for (const [repo, list] of byRepo) {
    if (list.length < 2) continue;
    const sections = new Set(list.map((e) => e.section));
    if (sections.size < list.length) dupSame.push({ repo, entries: list });
    else if (sections.size > 1) dupCross.push({ repo, entries: list });
  }

  console.log(`taxonomy 条目 ${entries.length}｜同分类重复 ${dupSame.length}｜跨分类重复 ${dupCross.length}`);
  for (const d of dupSame) {
    console.log(`  ✗ ${d.repo}（同分类重复）：${d.entries.map((e) => `L${e.line + 1}`).join(" / ")} @ ${d.entries[0]!.section}`);
  }
  for (const d of dupCross) {
    console.log(`  △ ${d.repo}（跨分类）：${d.entries.map((e) => e.section).join(" / ")}`);
  }

  if (fix && dupSame.length > 0) {
    const drop = new Set<number>();
    for (const d of dupSame) {
      // 同一分类内保留第一行，删除后出现的重复
      const seenSections = new Set<string>();
      for (const e of d.entries) {
        if (seenSections.has(e.section)) drop.add(e.line);
        else seenSections.add(e.section);
      }
    }
    const out = lines.filter((_, i) => !drop.has(i)).join("\n");
    const { writeFileAtomic } = require(LIB) as { writeFileAtomic: (p: string, s: string) => void };
    writeFileAtomic(TAXONOMY, out);
    const back = readFileSync(TAXONOMY, "utf8").split("\n");
    if (back.length !== lines.length - drop.size) throw new Error("写后读回失败：行数不符");
    console.log(`已删除 ${drop.size} 行同分类重复（vault 镜像随写入生效）`);
    return 0;
  }

  if (dupSame.length > 0) {
    console.log("\n修法：同分类重复跑 --fix（保留首次出现）；跨分类重复由人工决定归属后手动删一行。");
    return 1;
  }
  console.log("\nTAXONOMY DEDUPE OK：无同分类重复");
  return 0;
}

process.exit(main());
