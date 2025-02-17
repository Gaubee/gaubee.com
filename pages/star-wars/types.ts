export type Movie = {
  id: string;
  title: string;
  release_date: string;
};
export type MovieDetails = Movie & {
  id: string;
  title: string;
  release_date: string;
  director: string;
  producer: string;
};
