// https://vike.dev/onBeforePrerenderStart
export { onBeforePrerenderStart };

import type { OnBeforePrerenderStartAsync } from "vike/types";
import { getAllArticles } from "../../../database/articles.controller.ts";
import { Data } from "./+data.ts";

const onBeforePrerenderStart: OnBeforePrerenderStartAsync<Data> = async () => {
  const allArticles = await getAllArticles();
  console.log("onBeforePrerenderStart", "allArticles",allArticles.length);

  return [
    ...allArticles.map((article) => {
      const url = `/article/${encodeURIComponent(article.metadata.id)}`;
      return {
        url,
        // Note that we can also provide the `pageContext` of other pages.
        // This means that Vike will not call any
        // `data()` hook and the Star Wars API will be called
        // only once (in this `onBeforePrerenderStart()` hook).
        pageContext: {
          data: { article },
        },
      };
    }),
  ];
};
