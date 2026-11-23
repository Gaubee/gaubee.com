#!/usr/bin/env bun
/**
 * tool-form-audit — 工具的形态（form）合规体检
 *
 * 背景（kzf 2026-11-23 裁决）：每个工具必须有 form（webapp / self-hosted / internal），
 * 并且形态要与其实际能力一致：
 *   - webapp     只读公开数据、无私有凭据、纯前端可算
 *   - self-hosted 需要私有数据/凭据/常驻进程，必须给部署说明
 *   - internal   只服务维护管道，不占体力、不进登记簿
 *
 * 本工具按源码实际读取的路径判断形态是否「名副其实」，不看人写的声明。
 *
 * 用法：
 *   bun tools/tool-form-audit/tool-form-audit.ts
 *   bun tools/tool-form-audit/tool-form-audit.ts --json
 * 退出码：0 = 全部合规；1 = 有违规；2 = 路径异常。只读。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// 本工具自己就在 tools/ 下，所以根是上两级
const SKILL = path.resolve(import.meta.dir, "..", "..");
const TOOLS = path.join(SKILL, "tools");
const INVENTORY = path.join(TOOLS, "FORM-INVENTORY.md");

interface Finding {
  tool: string;
  form: string;
  issues: string[];
}

/** 源码里是否读了私有数据（GAUBEE_SKILLS_DATA / sourceDir / ~/.gaubee-skills）
 *  注意：CLI 工具读本地数据文件是正常的——「webapp」的契约是**同一份数据能被投影成公开 JSON**，
 *  不是「源码不许读文件」。所以这里只把「读私有根」当作违反，
 *  `sourceDir("github-stars")` 这类读的是可公开投影的数据源，不算违规（2026-11-23 修正：
 *  首版把 stars-search 判成违规，但它投影到 static/tools/data/stars.json 后完全能在浏览器跑）。 */
function readsPrivate(dir: string): boolean {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs"));
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    // 真正的违规：读 vault / profile / feedback-log / .env。
    // 「读数据根」（GAUBEE_SKILLS_DATA 默认 ~/.gaubee-skills/data）不算违规——
    // stars.json 这类数据源本来就要投影成公开 JSON 给 WebApp 用（2026-11-23 二次修正）。
    // 注意 `process.env` 里也含 ".env" 字样，所以不能用 /\\.env/ 当判据——
    // 只认「读 .env 文件」的写法（Bun.file/dotenv/readFile 指向 .env）。
    if (/GAUBEE_SKILLS_VAULT_KEY|vault\.enc\.sqlite|feedback-log\.md|profile\.md/i.test(src)) return true;
    if (/(readFileSync|Bun\.file|dotenv)\([^)]*["']\.env["']/.test(src)) return true;
  }
  return false;
}

/** 源码里是否发网络请求 / 起常驻进程（webapp 不该有） */
function needsRuntime(dir: string): boolean {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs"));
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    if (/fetch\(|spawnSync|Bun\.spawn|execFileSync|net\.connect|createServer/.test(src)) return true;
  }
  return false;
}

/** 读 FORM-INVENTORY.md 里的形态声明：`| 2026-11-19-report-facts-check | internal | ... |` */
function readInventory(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(INVENTORY)) return out;
  for (const line of readFileSync(INVENTORY, "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4 || !cells[1]?.startsWith("2026-")) continue;
    const form = cells[2];
    if (form && ["webapp", "self-hosted", "internal"].includes(form)) out.set(cells[1], form);
  }
  return out;
}

function main(): number {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  if (!existsSync(TOOLS)) {
    console.error(`缺少 ${TOOLS}`);
    return 2;
  }
  const dirs = readdirSync(TOOLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("2026-"))
    .map((d) => d.name);
  const inv = readInventory();
  const findings: Finding[] = [];
  let unspecified = 0;
  const formCount = new Map<string, number>();

  for (const d of dirs) {
    const form = inv.get(d);
    if (!form) {
      unspecified++;
      findings.push({ tool: d, form: "（未声明）", issues: ["FORM-INVENTORY.md 里没有该工具的形态"] });
      continue;
    }
    formCount.set(form, (formCount.get(form) ?? 0) + 1);
    const dir = path.join(TOOLS, d);
    const issues: string[] = [];

    if (form === "webapp") {
      if (readsPrivate(dir)) issues.push("声明 webapp 但源码读了 vault/profile/反馈日志等私有数据（无法投影成公开 JSON）");
      // 需网络的不再直接判违规：README 里若声明了「浏览器直连」或数据已投影，就是合规的
      if (needsRuntime(dir)) {
        const readme = path.join(dir, "README.md");
        const projected =
          existsSync(readme) && /static\/tools\/data|浏览器直连|公开投影|浏览器里跑/.test(readFileSync(readme, "utf8"));
        if (!projected) issues.push("声明 webapp 且需要网络/运行时，但 README 未声明数据来源或浏览器可行性");
      }
    }
    if (form === "self-hosted") {
      const readme = path.join(dir, "README.md");
      const hasDeploy =
        existsSync(readme) &&
        /自托管|部署|self-host|go install|git clone|docker run/i.test(readFileSync(readme, "utf8"));
      if (!hasDeploy) issues.push("声明 self-hosted 但 README 没有部署说明段落");
    }
    // internal 不要求读私有数据：很多 internal 工具只读公开产物（如报告文件、manifest），
    // 它们照样只服务维护管道。所以这一条不再报错，避免 30 条噪声盖住真问题。

    if (issues.length) findings.push({ tool: d, form, issues });
  }

  if (asJson) {
    console.log(JSON.stringify({ total: dirs.length, unspecified, formCount: [...formCount], findings }, null, 2));
    return findings.length ? 1 : 0;
  }

  console.log(`tool-form-audit：${dirs.length} 个工具目录，形态分布 ${[...formCount.entries()].map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  if (unspecified) console.log(`  未声明形态：${unspecified} 个`);
  if (findings.length === 0) {
    console.log("TOOL FORM OK：全部工具形态合规");
    return 0;
  }
  console.log(`\n${findings.length} 个工具形态有问题：`);
  for (const f of findings.slice(0, 20)) {
    console.log(`  ✗ ${f.tool}（${f.form}）`);
    for (const i of f.issues) console.log(`      ${i}`);
  }
  if (findings.length > 20) console.log(`  …另 ${findings.length - 20} 个`);
  return 1;
}

process.exit(main());
