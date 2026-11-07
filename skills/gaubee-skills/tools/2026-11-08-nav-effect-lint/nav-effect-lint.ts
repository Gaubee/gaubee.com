#!/usr/bin/env bun
/**
 * nav-effect-lint — 后台保活视图「抢导航」静态检查
 *
 * 背景（2026-11-08 实证）：main 区按 tab 保活，后台应用同样常驻 DOM，且拿到的是
 * 全局 location。EventView 的「月份必显式」$effect 在后台看到 urlMonth 为空，就
 * REPLACE 回 /app/event——用户点「桌面」后 URL 立刻被拉回去，桌面永远回不去。
 *
 * 规则：`$effect` 里调用导航（navigateMain / navController.* / go({...}) /
 * history.pushState|replaceState）必须显式判前台（isActive / useActive）。
 * 外壳级例外用注释标记 `nav-effect-allow` 放行（如 NotFound 重定向）。
 *
 * 用法：
 *   bun tools/2026-11-08-nav-effect-lint/nav-effect-lint.ts [--root <站点根>] [--json]
 * 退出码：0 = 无未设防的 effect 导航；1 = 发现风险；2 = 参数/路径异常。只读。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");

interface Finding {
  file: string;
  line: number;
  snippet: string;
  calls: string[];
}

const NAV_CALL = /\b(?:navigateMain|navigate|goById|go)\s*\(|\bnavController\.|history\.(?:pushState|replaceState)\s*\(/;
const GUARD = /\b(?:isActive|useActive)\b/;
const ALLOW_MARK = /nav-effect-allow/;

/** 收集 $effect(() => { ... }) 的 body（按花括号配平；跳过字符串里的括号足够应付本仓风格） */
function effectBodies(text: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  const re = /\$effect\s*\(\s*\(\s*\)\s*=>\s*\{/g;
  for (const m of text.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let i = open;
    let inStr: string | null = null;
    while (i < text.length) {
      const ch = text[i]!;
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === inStr) inStr = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    out.push({ start: m.index ?? 0, body: text.slice(open, i + 1) });
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".svelte")) out.push(p);
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1] ?? "") : DEFAULT_ROOT;
  const asJson = argv.includes("--json");
  if (!existsSync(root)) {
    console.error(`站点根不存在：${root}`);
    return 2;
  }
  const src = path.join(root, "src");
  if (!existsSync(src)) {
    console.error(`没有 src 目录：${src}`);
    return 2;
  }
  const files: string[] = [];
  walk(src, files);
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { start, body } of effectBodies(text)) {
      const calls = [...new Set((body.match(new RegExp(NAV_CALL.source, "g")) ?? []).map((s) => s.replace(/[\s(]+$/, "")))];
      if (calls.length === 0) continue;
      if (GUARD.test(body) || ALLOW_MARK.test(body)) continue;
      const line = text.slice(0, start).split("\n").length;
      const navLine =
        body
          .split("\n")
          .map((l) => l.trim())
          .find((l) => NAV_CALL.test(l) && !l.startsWith("//")) ?? "";
      findings.push({
        file: path.relative(root, file),
        line,
        snippet: navLine.slice(0, 120),
        calls,
      });
    }
  }
  if (asJson) {
    console.log(JSON.stringify({ root, scanned: files.length, findings }, null, 2));
    return findings.length ? 1 : 0;
  }
  console.log(`扫描 ${files.length} 个 .svelte（${root}）`);
  if (findings.length === 0) {
    console.log("OK：所有 effect 内导航都有前台判断（isActive/useActive）或 nav-effect-allow 标记");
    return 0;
  }
  console.log(`发现 ${findings.length} 处未设防的 effect 导航：`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  ${f.calls.join(" ")}`);
    console.log(`    ${f.snippet}`);
  }
  console.log("修法：在 effect 开头加 `if (!isActive) return`（useActive() 取上下文），或确认是外壳级行为后标 `nav-effect-allow`");
  return 1;
}

process.exit(main());
