import path from "node:path";
import fs from "node:fs";
import matter, { GrayMatterFile } from "gray-matter";
import { walkFiles } from "@gaubee/nodekit";
import { func_remember } from "@gaubee/util";
import { md } from "./markdown.helper";

export const getAllArticles = func_remember(async () => {
  const articlesDirname = path.resolve(
    import.meta.dirname,
    "../../src/articles"
  );
  return (
    await Promise.all(
      [...walkFiles(articlesDirname)].map(async (entry) => {
        if (!(entry.path.endsWith(".md") || entry.path.endsWith(".mdx"))) {
          return;
        }
        const info = matter(entry.readText());
        const title = info.data.title || path.parse(entry.name).name;
        const createdAt = new Date(info.data.date || entry.stats.birthtimeMs);
        const updatedAt = new Date(info.data.updated || entry.stats.ctimeMs);
        const tags = Array.isArray(info.data.tags) ? info.data.tags : [];
        return {
          metadata: { ...info.data, title, createdAt, updatedAt, tags },
          htmlContent: await md.renderAsync(info.content),
        };
      })
    )
  )
    .filter((it) => it !== undefined)
    .sort(
      (a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime()
    );
});
