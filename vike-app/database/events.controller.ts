import path from "node:path";
import matter, { GrayMatterFile } from "gray-matter";
import { walkFiles } from "@gaubee/nodekit";
import { func_remember } from "@gaubee/util";
import { md } from "./markdown.helper";

export const getAllEvents = func_remember(async () => {
  const eventsDirname = path.resolve(import.meta.dirname, "../../src/events");
  return (
    await Promise.all(
      [...walkFiles(eventsDirname)].map(async (entry) => {
        if (!(entry.path.endsWith(".md") || entry.path.endsWith(".mdx"))) {
          return;
        }
        const info = matter(entry.readText());
        const createdAt = new Date(info.data.date || entry.stats.birthtimeMs);
        return {
          metadata: { ...info.data, createdAt },
          htmlContent: await md.renderAsync(info.content),
        };
      })
    )
  ).filter((it) => it !== undefined);
});
