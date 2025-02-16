// https://vike.dev/data
export { data };
export type Data = Awaited<ReturnType<typeof data>>;

// The node-fetch package (which only works on the server-side) can be used since
// this file always runs on the server-side, see https://vike.dev/data#server-side
import type { PageContextServer } from "vike/types";

import path from "node:path";
import matter from "gray-matter";
import { walkFiles } from "@gaubee/nodekit";

function getArticles() {
  const articlesDirname = path.resolve(
    import.meta.dirname,
    "../../../src/articles"
  );
  console.log("dir", articlesDirname);
  return [...walkFiles(articlesDirname)].map((entry) => {
    console.log(entry.path);
    return matter(entry.readText());
  });
}

const data = async (pageContext: PageContextServer) => {
  const articles = await getArticles();
  return {
    // We remove data we don't need because the data is passed to the client; we should
    // minimize what is sent over the network.
    articles: articles,
  };
};
