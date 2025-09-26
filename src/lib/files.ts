import { glob } from "glob";
import path from "path";

export async function getNextPostId(type: "article" | "event"): Promise<number> {
  const files = await glob(`src/content/${type}s/*.md`);
  if (files.length === 0) {
    return 1;
  }

  const ids = files.map((file) => {
    const filename = path.basename(file);
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });

  return Math.max(...ids) + 1;
}

export { getFileContent } from "./github";