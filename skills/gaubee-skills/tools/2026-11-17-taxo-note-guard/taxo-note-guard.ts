#!/usr/bin/env bun
/**
 * taxo-note-guard — 防止 taxonomy 注释里的「历史名」被当成残留引用
 *
 * 背景（2026-11-17 实证）：rename-impact-audit 按仓库全名扫 taxonomy，判断是否还引用旧名。
 * 为了可追溯，我在 taxonomy 条目里写了一行「（原 google/gvisor，已迁组织）」，
 * 结果被判定为「taxonomy 仍引用旧名」，工具从绿转红。这不是工具的错——它无法区分
 * 「用作说明的历史名」与「仍当作有效链接的旧名」。
 *
 * 本工具做两件事：
 *   1. 扫描 taxonomy 里出现在**链接位**的仓库名（`](https://github.com/owner/name)`），
 *      这是唯一会真的指向旧地址的位置；
 *   2. 把查到的「名字与 URL 不一致」列出来（链接文字说 A、URL 指向 B）。
 *
 * 与 rename-impact-audit 的分工：那个工具管「改名影响面」，本工具管「链接位自洽」。
 * 注释里提历史名是允许的，链接位指向旧地址才是错的。
 *
 * 用法：
 *   bun tools/2026-11-17-taxo-note-guard/taxo-note-guard.ts
 *   bun tools/2026-11-17-taxo-note-guard/taxo-note-guard.ts --json
 * 退出码：0 = 链接位全部自洽；1 = 有链接文字与 URL 不一致；2 = 数据缺失。只读。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const TAXONOMY = path.join(DATA, "taxonomy.md");

interface Mismatch {
  line: number;
  label: string;
  urlRepo: string;
  section: string;
}

/** 只关心 GitHub 仓库链接：`- [owner/name](https://github.com/owner/name)` */
const LINK_RE = /\[([^\]]+)\]\(https:\/\/github\.com\/([^)\s]+)\)/g;

function main(): number {
  const asJson = process.argv.includes("--json");
  if (!existsSync(TAXONOMY)) {
    console.error(`缺少：${TAXONOMY}`);
    return 2;
  }
  const lines = readFileSync(TAXONOMY, "utf8").split("\n");

  const mismatches: Mismatch[] = [];
  let section = "";
  let checked = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const head = line.match(/^###\s+(.+)$/);
    if (head) {
      section = head[1]!.replace(/（\d+）$/, "");
      continue;
    }
    for (const m of line.matchAll(LINK_RE)) {
      const label = m[1]!.trim();
      const urlRepo = m[2]!.replace(/\/+$/, "");
      // 只比 owner/name 形态的 label（分类「代表」行里可能写裸名字，那些不算链接位）
      if (!/^[\w.-]+\/[\w.-]+$/.test(label)) continue;
      checked++;
      // 大小写不敏感比较 owner/name：GitHub 仓库名大小写不敏感，
      // 大小写差异算「可接受但值得提醒」，这里只报路径不同
      if (label.toLowerCase() !== urlRepo.toLowerCase()) {
        mismatches.push({ line: i + 1, label, urlRepo, section });
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ checked, mismatches }, null, 2));
    return mismatches.length ? 1 : 0;
  }

  console.log(`taxonomy 链接位体检：${checked} 个仓库链接（注释与正文里的历史名不计）`);
  if (mismatches.length === 0) {
    console.log("TAXO NOTE OK：所有链接文字与 URL 指向同一仓库");
    console.log("提示：条目说明里写「原 owner/name」是允许的，不会影响本检查。");
    return 0;
  }
  console.log(`\n${mismatches.length} 处链接文字与 URL 不一致：`);
  for (const m of mismatches) {
    console.log(`  L${m.line}  ${m.label}  →  ${m.urlRepo}   @ ${m.section}`);
  }
  return 1;
}

process.exit(main());
