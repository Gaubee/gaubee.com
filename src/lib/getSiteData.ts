import { func_remember } from "@gaubee/util/func";
import { getCollection } from "astro:content";
import { match, P } from "ts-pattern";
import { extractImagesFromMarkdown, getMdTitle } from "./markdownUtils";
func_remember;
export const getSiteData = async () => {
  const articles_raw = await getCollection("articles");
  const events_raw = await getCollection("events");

  const toSafeData = (data: Record<string, unknown>, fileName?: string) => {
    // if (!data.date) {
    //   throw new Error(`${fileName} has no date`);
    // }
    const createdAt = match(data.date)
      .with(P.string, P.number, P.instanceOf(Date), (d) => new Date(d))
      .otherwise(() => {
        throw new Error(`${fileName} has no date`);
      });
    const updatedAt = match(data.updated)
      .with(P.string, P.number, P.instanceOf(Date), (d) => new Date(d))
      .otherwise(() => createdAt);

    return Object.assign(data, {
      title: match(data.title)
        .with(P.string.minLength(1), (title) => title)
        .otherwise(() => undefined),
      date: createdAt,
      updated: updatedAt,
      tags: match(data.tags)
        .with(P.array(), (targs) => targs)
        .with(P.string, (tag) => [tag])
        .with(P.number, P.boolean, (tag) => [tag.toString()])
        .otherwise(() => []) as string[],
      preview: match(data.preview)
        .with(P.string, (s) => s)
        .otherwise(() => ""),
      previewHTML: match(data.previewHTML)
        .with(P.string, (s) => s)
        .otherwise(() => ""),
    });
  };
  const articles = articles_raw.map((p) => ({
    ...p,
    data: toSafeData(p.data, p.id),
    images:
      p.rendered?.metadata?.imagePaths ??
      extractImagesFromMarkdown(p.body ?? ""),
    safeTitle: getMdTitle(p.data.title, p.body, p.id),
    contentUrl: `/${p.collection}/${p.id}`,
  }));

  const events = events_raw.map((p) => ({
    ...p,
    data: toSafeData(p.data, p.id),
    images:
      p.rendered?.metadata?.imagePaths ??
      extractImagesFromMarkdown(p.body ?? ""),
    safeTitle: getMdTitle(p.data.title, p.body, p.id),
    contentUrl: `/${p.collection}/${p.id}`,
  }));

  const dateSorter = (
    a: { data: { date: Date } },
    b: { data: { date: Date } },
  ) => b.data.date.getTime() - a.data.date.getTime();
  const allEvents = events.sort(dateSorter);
  const allArticles = articles.sort(dateSorter);
  const allPosts = [...allArticles, ...allEvents].sort(dateSorter);

  const postsByMonth = allPosts.reduce(
    (acc, post) => {
      const year = post.data.date.getFullYear();
      const month = (post.data.date.getMonth() + 1).toString().padStart(2, "0");
      const key = `${year}-${month}`;
      if (!acc[key]) {
        acc[key] = 0;
      }
      acc[key]++;
      return acc;
    },
    {} as Record<string, number>,
  );

  const allTags = [...new Set(allPosts.flatMap((p) => p.data.tags || []))];

  return { allEvents, allArticles, allPosts, postsByMonth, allTags };
};
