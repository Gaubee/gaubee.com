// https://vike.dev/data
export { data };
export type Data = Awaited<ReturnType<typeof data>>;

import { getAllArticles } from "../../database/articles.controller.ts";
import { getAllEvents } from "../../database/events.controller.ts";
import { map_get_or_put } from "@gaubee/util";
import { markdownToHtml } from "../../database/markdown.helper.ts";

const data = async () => {
  const articles = await getAllArticles();
  const events = await getAllEvents();
  type Articles = (typeof articles)[number];
  type Event = (typeof events)[number];
  const years = new Map<
    number,
    Array<
      | {
          type: "article";
          createdAt: Date;
          data: Articles["metadata"] & { previewContent: string };
        }
      | {
          type: "event";
          createdAt: Date;
          data: Event;
        }
    >
  >();
  for (const article of articles) {
    map_get_or_put(
      years,
      article.metadata.createdAt.getFullYear(),
      () => []
    ).push({
      type: "article",
      createdAt: article.metadata.createdAt,
      data: {
        ...article.metadata,
        previewContent: await markdownToHtml(
          article.markdownContent.split("\n").slice(0, 20).join("\n"),
          { filepath: article.fileEntry.path }
        ),
      },
    });
  }
  for (const event of events) {
    map_get_or_put(
      years,
      event.metadata.createdAt.getFullYear(),
      () => []
    ).push({
      type: "event",
      createdAt: event.metadata.createdAt,
      data: event,
    });
  }
  const data = [...years]
    .map(([year, items]) => {
      return {
        year,
        items: items.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        ),
      };
    })
    .sort((a, b) => b.year - a.year);
  return data;
};
