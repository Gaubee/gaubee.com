// https://vike.dev/data
export { data };
export type Data = Awaited<ReturnType<typeof data>>;

// The node-fetch package (which only works on the server-side) can be used since
// this file always runs on the server-side, see https://vike.dev/data#server-side
import type { PageContextServer } from "vike/types";

import { getAllArticles } from "../../database/articles.controller";
import { getAllEvents } from "../../database/events.controller";

const data = async (pageContext: PageContextServer) => {
  const articles = await getAllArticles();
  const events = await getAllEvents();
  return {
    articles: articles,
    events: events,
  };
};
