// https://vike.dev/data
export { data };
export type Data = Awaited<ReturnType<typeof data>>;

// The node-fetch package (which only works on the server-side) can be used since
// this file always runs on the server-side, see https://vike.dev/data#server-side
import type { PageContextServer } from "vike/types";

import { getAllArticles } from "../../database/articles.controller";
import { getAllEvents } from "../../database/events.controller";
import { map_get_or_put } from "@gaubee/util";

const data = async (pageContext: PageContextServer) => {
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
          data: Articles["metadata"];
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
      data: article.metadata,
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
