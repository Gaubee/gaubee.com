import { walkFiles } from "@gaubee/nodekit";
import { func_remember } from "@gaubee/util";
import matter from "gray-matter";
import { rootResolver } from "./common.helper.ts";
import { markdownToHtml } from "./markdown.helper.ts";

export const getAllEvents = func_remember(async () => {
  const eventsDirname = rootResolver("./events");
  return (
    await Promise.all(
      [...walkFiles(eventsDirname)].map(async (entry) => {
        if (!(entry.path.endsWith(".md") || entry.path.endsWith(".mdx"))) {
          return;
        }
        const info = matter(entry.readText());
        const createdAt = new Date(info.data.date || entry.stats.birthtimeMs);
        return {
          fileEntry: entry,
          originMetadata: info.data,
          metadata: { ...info.data, createdAt },
          markdownContent: info.content,
          htmlContent: await markdownToHtml(info.content, {
            filepath: entry.path,
          }),
        };
      })
    )
  )
    .filter((it) => it !== undefined)
    .sort(
      (a, b) =>
        b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime() ||
        b.fileEntry.name.localeCompare(a.fileEntry.name)
    );
});
