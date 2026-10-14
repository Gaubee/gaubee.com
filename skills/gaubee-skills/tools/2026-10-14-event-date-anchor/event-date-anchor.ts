// event-date-anchor.ts — 报告类 event 的日期锚定修复（kzf 2026-10-14 裁决的存量执行）
//
// 裁决：「X、GitHub 这一类的提交，必须跟随对应当天，而不是基于我们修改的那天来定
// 日期；即便后续做了修复和更改。」存量盘点（2026-10-14）发现两类漂移：
//   1. publish.ts 直通 bug 剥掉 frontmatter（01818~01830 九份）→ date 落到 1970，
//      最近列表沉底不可见；
//   2. 手写时代 date=发布时刻（00024/00025/01809~01816/01826）→ 比报告日晚一天。
//
// 本工具把报告类 event（slug 含 x-daily / github-daily / signals-weekly / monthly /
// yearly）的 date 统一锚定到「报告日」：
//   - 日报 = slug 里的 YYYY-MM-DD（T-1 语义的报告日，非发布日）
//   - 周报 = 标题窗口「～<周日>」的末日；缺标题时按 ISO 周推算周日
//   - 月报/年报 = 月末日 / 12-31
// frontmatter 缺失时补齐（title/tags 按类型推导，date=报告日 date-only，与归档口径
// 一致）；date 已正确则不动。默认 dry-run，--execute 才写盘。幂等。
//
// 用法: bun tools/2026-10-14-event-date-anchor/event-date-anchor.ts [--execute]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVENTS = new URL("../../../../src/content/events", import.meta.url).pathname;
const execute = process.argv.includes("--execute");

function isoWeekSunday(year: number, week: number): string {
  // ISO 周：含首个周四的周为第 1 周；周一 + week-1 周 + 6 天 = 周日
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() + 1 - day);
  const sun = new Date(week1Mon);
  sun.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7 + 6);
  return sun.toISOString().slice(0, 10);
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

type Plan = { file: string; action: string; detail: string };

const plans: Plan[] = [];
for (const f of readdirSync(EVENTS).filter((x) => x.endsWith(".md")).sort()) {
  const slugDate = f.match(/(?:x-daily|github-daily)-(\d{4}-\d{2}-\d{2})/)?.[1];
  const week = f.match(/signals-weekly-(?:(\d{4})-?)?W(\d{2})/);
  const month = f.match(/signals-monthly-(\d{4}-\d{2})/);
  const year = f.match(/signals-yearly-(\d{4})/);
  if (!slugDate && !week && !month && !year) continue;

  const abs = join(EVENTS, f);
  const raw = readFileSync(abs, "utf8");
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const fmMatch = raw.match(fmRe);
  const fm = fmMatch?.[1] ?? "";

  let anchor = "";
  let defTitle = "";
  let defTags: string[] = [];
  if (slugDate) {
    anchor = slugDate;
    if (f.includes("x-daily")) {
      defTitle = `X 日报：${slugDate}`;
      defTags = ["event", "signals", "x"];
    } else {
      defTitle = `GitHub 日报：${slugDate}`;
      defTags = ["event", "signals", "github"];
    }
  } else if (week) {
    const winEnd = fm.match(/～(\d{4}-\d{2}-\d{2})/)?.[1];
    const yr = Number(week[1] ?? winEnd?.slice(0, 4) ?? new Date().getFullYear());
    anchor = winEnd ?? isoWeekSunday(yr, Number(week[2]));
    defTitle = `GitHub 周报`;
    defTags = ["event", "signals"];
  } else if (month) {
    anchor = monthEnd(month[1]);
    defTitle = `GitHub 月报`;
    defTags = ["event", "signals"];
  } else {
    anchor = `${year[1]}-12-31`;
    defTitle = `GitHub 年报`;
    defTags = ["event", "signals"];
  }

  if (!fmMatch) {
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = f.includes("signals-") && titleMatch ? titleMatch[1]!.trim() : defTitle;
    plans.push({
      file: f,
      action: "补 frontmatter",
      detail: `title="${title}" date="${anchor}" tags=${JSON.stringify(defTags)}`,
    });
    if (execute) {
      const fmText = ["---", `title: "${title}"`, `date: "${anchor}"`, "tags:", ...defTags.map((t) => `  - ${t}`), "---", ""].join("\n");
      writeFileSync(abs, `${fmText}${raw}`);
    }
    continue;
  }

  const dateMatch = fm.match(/^date:\s*"([^"]+)"/m);
  const current = dateMatch?.[1] ?? "";
  if (current.slice(0, 10) === anchor) {
    plans.push({ file: f, action: "KEEP", detail: `date=${current} 已锚定` });
    continue;
  }
  plans.push({ file: f, action: "改 date", detail: `${current || "（缺失）"} → ${anchor}` });
  if (execute) {
    const next = dateMatch
      ? raw.replace(/^date:\s*"[^"]*"/m, `date: "${anchor}"`)
      : raw.replace(/^---\n/, `---\ndate: "${anchor}"\n`);
    writeFileSync(abs, next);
  }
}

for (const p of plans) console.log(`${p.action === "KEEP" ? "  KEEP" : p.action} ${p.file}：${p.detail}`);
console.log(execute ? `已写盘 ${plans.filter((p) => p.action !== "KEEP").length} 处` : `dry-run：${plans.filter((p) => p.action !== "KEEP").length} 处待修（加 --execute 落盘）`);
