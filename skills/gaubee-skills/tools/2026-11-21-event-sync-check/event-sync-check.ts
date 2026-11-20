#!/usr/bin/env bun
/**
 * event-sync-check — 报告文件与已发布 event 是否一致
 *
 * 背景（2026-11-21 实证）：回补日报时要同时改两处——`reports/daily/<date>.md` 与
 * `src/content/events/<序号>.<slug>.md`。只改一处，站点上与档案里就是两个版本，
 * 而且没人会发现：publish 之后两者不再有自动同步关系。
 *
 * 本工具逐个日期比对「去掉 frontmatter 后的正文」，列出不一致的日期与首个差异行。
 * 只读，不改文件。
 *
 * 用法：
 *   bun tools/2026-11-21-event-sync-check/event-sync-check.ts
 *   bun tools/2026-11-21-event-sync-check/event-sync-check.ts --since 2026-11-01
 * 退出码：0 = 全部一致；1 = 有差异；2 = 路径缺失。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SKILL = path.join(SITE, "skills", "gaubee-skills");
const REPORTS = path.join(SKILL, "reports", "daily");
const EVENTS = path.join(SITE, "src", "content", "events");

/** 去掉 frontmatter（首个 --- 到第二个 ---） */
function body(text: string): string {
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  return (m ? text.slice(m[0].length) : text).trim();
}

interface Diff {
  date: string;
  event: string;
  kind: "missing-event" | "content" | "only-frontmatter";
  detail: string;
}

function firstDiff(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if ((la[i] ?? "") !== (lb[i] ?? "")) {
      return `第 ${i + 1} 行：报告「${(la[i] ?? "(无)").slice(0, 60)}」 vs event「${(lb[i] ?? "(无)").slice(0, 60)}」`;
    }
  }
  return "长度相同但内容不同（不应发生）";
}

function main(): number {
  const argv = process.argv.slice(2);
  const si = argv.indexOf("--since");
  const since = si >= 0 ? (argv[si + 1] ?? "2026-10-01") : "2026-10-01";
  const os_ = os; // 避免未使用告警
  void os_;
  for (const p of [REPORTS, EVENTS]) {
    if (!existsSync(p)) {
      console.error(`缺少：${p}`);
      return 2;
    }
  }

  const eventFiles = readdirSync(EVENTS);
  const diffs: Diff[] = [];
  let checked = 0;
  for (const f of readdirSync(REPORTS).filter((x) => /^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort()) {
    const date = f.slice(0, 10);
    if (date < since) continue;
    const slug = `github-daily-${date}`;
    const ev = eventFiles.find((x) => x.endsWith(`.${slug}.md`));
    if (!ev) {
      diffs.push({ date, event: "—", kind: "missing-event", detail: "已写报告但没发布 event" });
      continue;
    }
    checked++;
    const a = body(readFileSync(path.join(REPORTS, f), "utf8"));
    const b = body(readFileSync(path.join(EVENTS, ev), "utf8"));
    if (a === b) continue;
    const trimmedA = a.trim();
    const trimmedB = b.trim();
    if (trimmedA === trimmedB) {
      diffs.push({ date, event: ev, kind: "only-frontmatter", detail: "正文一致，只有 frontmatter 差异" });
    } else {
      diffs.push({ date, event: ev, kind: "content", detail: firstDiff(trimmedA, trimmedB) });
    }
  }

  console.log(`event-sync-check：从 ${since} 起核对 ${checked} 份已发布日报`);
  if (diffs.length === 0) {
    console.log("EVENT SYNC OK：报告与 event 正文一致");
    return 0;
  }
  console.log(`\n${diffs.length} 处不一致：`);
  for (const d of diffs) {
    const tag = d.kind === "missing-event" ? "未发布" : d.kind === "content" ? "正文不同" : "仅 frontmatter";
    console.log(`  [${tag}] ${d.date}  ${d.event}`);
    console.log(`      ${d.detail}`);
  }
  console.log("\n提示：正文不同说明改了一处忘了另一处；event 编号冻结，改它用同文件原地重写。");
  return 1;
}

process.exit(main());
