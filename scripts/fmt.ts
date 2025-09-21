/**
 * 格式化所有存在 Git 变更的文件（不含 untracked）
 * 用法：
 *   npx ts-node format-changed.ts
 *   # 或者给 chmod +x format-changed.ts 后
 *   ./format-changed.ts
 */

import { blue, green } from "@gaubee/nodekit";
import { $, execaSync } from "execa";
import { existsSync } from "node:fs";
import path from "node:path";

function resolvePrettier() {
  const local = path.join(process.cwd(), "node_modules", ".bin", "prettier");
  const ext = process.platform === "win32" ? ".CMD" : "";
  return existsSync(local) ? [local + ext] : ["pnpm", "prettier"];
}
const PRETTIER_BIN = resolvePrettier();

function gitChangedFiles(): string[] {
  // 已暂存 + 未暂存 的变更文件；不含 untracked
  const stdout = execaSync`git diff --name-only HEAD`;
  return stdout.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((filename) => /\.(ts|tsx|mts|cts|css|html|json)/.test(filename));
}

function run(cmd: string, args: string[]): void {
  console.log(
    green(
      `Running: ${cmd} ${args.slice(0, args.indexOf("--experimental-cli"))}`
    )
  );
  const child = $(cmd, args, {
    stdio: "inherit",
  });
  child.on("exit", (code: number) => process.exit(code));
}

function main(): void {
  const files = gitChangedFiles();
  if (files.length === 0) {
    console.log("No changed files to format.");
    return;
  }
  console.log(green("Prettier formatting:"));
  files.forEach((f) => console.log("  -", blue(f)));

  run(PRETTIER_BIN[0], [
    ...PRETTIER_BIN.slice(1),
    "--experimental-cli",
    "--write",
    ...files,
  ]);
}

main();
