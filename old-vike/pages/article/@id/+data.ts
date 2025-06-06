// https://vike.dev/data
export {data};
export type Data = Awaited<ReturnType<typeof data>>;

import {redirect} from 'vike/abort';
import type {PageContextServer} from 'vike/types';
import {getAllArticles} from '../../../database/articles.controller.ts';

const data = async (pageContext: PageContextServer) => {
  const allArticles = await getAllArticles();
  const article = allArticles.find((it) => it.metadata.id === pageContext.routeParams!.id);

  if (!article) {
    throw redirect('/404', 301);
  }

  return {
    article,
  };
};
