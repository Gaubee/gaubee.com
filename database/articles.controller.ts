import { walkFiles } from "@gaubee/nodekit";
import { func_remember } from "@gaubee/util";
import matter from "gray-matter";
import path from "node:path";
import { rootResolver } from "./common.helper.ts";
import { md } from "./markdown.helper.ts";

export const getAllArticles = func_remember(async () => {
  const articlesDirname = rootResolver("./articles");

  return (
    await Promise.all(
      [...walkFiles(articlesDirname)].map(async (entry) => {
        if (!(entry.path.endsWith(".md") || entry.path.endsWith(".mdx"))) {
          return;
        }
        const info = matter(entry.readText());
        const id = path.parse(entry.name).name;
        const title = info.data.title || id;
        const createdAt = new Date(info.data.date || entry.stats.birthtimeMs);
        const updatedAt = new Date(info.data.updated || entry.stats.ctimeMs);
        const tags = Array.isArray(info.data.tags) ? info.data.tags : [];
        return {
          fileEntry: entry,
          originMetadata: info.data,
          metadata: { ...info.data, id, title, createdAt, updatedAt, tags },
          htmlContent: await md.renderAsync(info.content),
          markdownContent: info.content,
        };
      })
    )
  )
    .filter((it) => it !== undefined)
    .sort(
      (a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime()
    );
});
