import { walkFiles } from "@gaubee/nodekit";
import { func_remember } from "@gaubee/util";
import matter from "gray-matter";
import { rootResolver } from "./common.helper.ts";
import { md } from "./markdown.helper.ts";

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
          metadata: { ...info.data, createdAt },
          htmlContent: await md.renderAsync(info.content),
        };
      })
    )
  ).filter((it) => it !== undefined);
});
