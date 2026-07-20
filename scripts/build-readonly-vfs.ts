#!/usr/bin/env node
/**
 * 构建时脚本：将 src/content 下的 markdown 文件预解析为 JSON，
 * 生成 src/lib/vfs/readonly-data.ts，供 ReadonlyVFS 使用。
 *
 * 用法：node scripts/build-readonly-vfs.js
 * 或在 package.json 的 build 脚本中调用。
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "src", "content");
const OUTPUT_FILE = join(__dirname, "..", "src", "lib", "vfs", "readonly-data.ts");

/** 递归读取目录下的所有 .md 文件。 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(path)));
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

async function main() {
  console.log("🔧 构建只读 VFS 数据...");

  const markdownFiles = await findMarkdownFiles(CONTENT_DIR);
  console.log(`📄 找到 ${markdownFiles.length} 个 markdown 文件`);

  const fileMap: Record<string, string> = {};

  for (const filePath of markdownFiles) {
    const content = await readFile(filePath, "utf-8");
    // 相对路径：src/content/articles/xxx.md
    const relativePath = relative(join(__dirname, ".."), filePath);
    fileMap[relativePath] = content;
  }

  // 生成 TypeScript 文件
  const tsContent = `/**
 * 只读 VFS 数据 —— 构建时自动生成。
 * 
 * 由 scripts/build-readonly-vfs.ts 生成，不要手动修改。
 * 数据来自 src/content 下的 markdown 文件。
 */

export const readonlyFiles: Record<string, string> = ${JSON.stringify(fileMap, null, 2)};
`;

  await Bun.write(OUTPUT_FILE, tsContent);
  console.log(`✅ 已生成 ${relative(join(__dirname, ".."), OUTPUT_FILE)}`);
  console.log(`   包含 ${Object.keys(fileMap).length} 个文件`);
}

main().catch((err) => {
  console.error("❌ 构建失败:", err);
  process.exit(1);
});
