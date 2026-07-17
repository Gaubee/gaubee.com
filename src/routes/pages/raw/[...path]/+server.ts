import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { error } from "@sveltejs/kit";

export const prerender = true;

/** 枚举所有 markdown 文件作为 raw 端点路径。 */
export async function entries() {
  const { readdir } = await import("node:fs/promises");
  const collections = ["articles", "events"] as const;
  const out: Array<{ path: string }> = [];
  for (const c of collections) {
    const dir = join(process.cwd(), "src/content", c);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      out.push({ path: `${c}/${f}` });
    }
  }
  return out;
}

export async function GET({ params }): Promise<Response> {
  const { path } = params;
  // 安全校验：只允许 src/content 下的 .md
  if (!/^\.+$/.test(path) && path.includes("..")) {
    error(403, "Forbidden");
  }
  if (!path.endsWith(".md")) {
    error(404, "Not found");
  }
  const filePath = join(process.cwd(), "src/content", path);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    error(404, "Not found");
  }
  return new Response(raw, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
