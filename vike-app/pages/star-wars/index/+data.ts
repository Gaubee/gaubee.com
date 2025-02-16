// https://vike.dev/data
export { data };
export type Data = Awaited<ReturnType<typeof data>>;

// The node-fetch package (which only works on the server-side) can be used since
// this file always runs on the server-side, see https://vike.dev/data#server-side
import type { PageContextServer } from "vike/types";
import {
  getStarWarsMovies,
  filterMoviesData,
  getTitle,
} from "./getStarWarsMovies";

const data = async (pageContext: PageContextServer) => {
  const movies = await getStarWarsMovies();
  return {
    // We remove data we don't need because the data is passed to the client; we should
    // minimize what is sent over the network.
    movies: filterMoviesData(movies),
    // The page's <title>
    title: getTitle(movies),
  };
};
