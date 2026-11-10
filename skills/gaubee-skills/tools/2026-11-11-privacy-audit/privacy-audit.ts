#!/usr/bin/env bun
/**
 * privacy-audit — 发布仓隐私红线体检
 *
 * 两条红线（SKILL §4）：
 * 1. 私有数据（~/.gaubee-skills 下的 sources/profile/feedback-log/vault/.env）绝不进 git；
 * 2. 发布内容（reports/ 与 src/content/events/）不出现本机绝对路径（/Users/… 会被公开）。
 *
 * 做法：`git ls-files` 列受版本控制的文件，按路径模式查私有数据泄漏；再对发布内容
 * 做一次绝对路径扫描。只读，不改仓库。
 *
 * 用法：bun tools/2026-11-11-privacy-audit/privacy-audit.ts [--root <仓库根>]
 * 退出码：0 = 干净；1 = 有违规；2 = 路径/命令异常。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");

/** 受控路径里不允许出现的私有数据模式 */
const FORBIDDEN: { re: RegExp; why: string }[] = [
  // .env.example / .sample / .template 是合规的键名模板，不算泄漏
  { re: /(^|\/)\.env$|(^|\/)\.env\.(?!example|sample|template)[A-Za-z0-9_-]+$/, why: ".env 凭据" },
  { re: /(^|\/)vault\.enc\.sqlite$/, why: "加密 vault 单文件" },
  // 私有数据布局限定在 data/ 下，避免误伤源码目录 src/lib/x/sources/
  { re: /(^|\/)data\/profile\.md$/, why: "品味画像" },
  { re: /(^|\/)data\/feedback-log\.md$/, why: "裁决原始日志" },
  { re: /(^|\/)data\/sources\//, why: "私有信号源数据" },
  { re: /(^|\/)data\/sources\/github-stars\/stars\.json$/, why: "星标快照" },
  { re: /(^|\/)data\/sources\/x-likes\/x\.json$/, why: "X 私有库" },
  { re: /(^|\/)(id_rsa|id_ed25519)$/, why: "SSH 私钥" },
  { re: /\.pem$/, why: "证书/私钥" },
];

const PUBLISHABLE = [/^skills\/gaubee-skills\/reports\//, /^src\/content\/events\//];

function main(): number {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1] ?? "") : DEFAULT_ROOT;
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    console.error(`不是 git 仓库或无法执行 git ls-files：${root}`);
    return 2;
  }

  const leaks: { file: string; why: string }[] = [];
  for (const f of files) {
    for (const rule of FORBIDDEN) {
      if (rule.re.test(f)) {
        leaks.push({ file: f, why: rule.why });
        break;
      }
    }
  }

  const absRe = /\/Users\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._-]+\//;
  const absHits: { file: string; line: number; snippet: string }[] = [];
  for (const f of files) {
    if (!PUBLISHABLE.some((re) => re.test(f))) continue;
    const text = readFileSync(path.join(root, f), "utf8");
    text.split("\n").forEach((line, i) => {
      if (absRe.test(line)) absHits.push({ file: f, line: i + 1, snippet: line.trim().slice(0, 100) });
    });
  }

  console.log(`受控文件 ${files.length} 个；私有数据泄漏 ${leaks.length}；发布内容绝对路径 ${absHits.length}`);
  for (const l of leaks.slice(0, 20)) console.log(`  ✗ ${l.file}（${l.why}）`);
  if (leaks.length > 20) console.log(`  …共 ${leaks.length}`);
  for (const a of absHits.slice(0, 10)) console.log(`  ✗ ${a.file}:${a.line} ${a.snippet}`);
  if (absHits.length > 10) console.log(`  …共 ${absHits.length}`);

  if (leaks.length || absHits.length) {
    console.log("\n修法：私有数据移出仓库（只留 ~/.gaubee-skills）；发布内容里的本机路径改成相对描述。");
    return 1;
  }
  console.log("\nPRIVACY OK：私有数据未入 git，发布内容无本机绝对路径");
  return 0;
}

process.exit(main());
