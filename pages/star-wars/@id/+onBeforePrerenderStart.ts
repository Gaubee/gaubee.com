// https://vike.dev/onBeforePrerenderStart
export { onBeforePrerenderStart };

import type { OnBeforePrerenderStartAsync } from "vike/types";
import type { Data as DataMovies } from "../index/+data";
import type { Data as DataMovie } from "./+data";
import { filterMovieData } from "../filterMovieData";
import {
  filterMoviesData,
  getStarWarsMovies,
  getTitle,
} from "../index/getStarWarsMovies";

type Data = DataMovie | DataMovies;

const onBeforePrerenderStart: OnBeforePrerenderStartAsync<
  Data
> = async (): ReturnType<OnBeforePrerenderStartAsync<Data>> => {
  console.log("onBeforePrerenderStart", "movies");
  const movies = await getStarWarsMovies();

  return [
    ...movies.map((movie) => {
      const url = `/star-wars/${movie.id}`;
      return {
        url,
        // Note that we can also provide the `pageContext` of other pages.
        // This means that Vike will not call any
        // `data()` hook and the Star Wars API will be called
        // only once (in this `onBeforePrerenderStart()` hook).
        pageContext: {
          data: {
            movie: filterMovieData(movie),
            title: movie.title,
          },
        },
      };
    }),
  ];
};
