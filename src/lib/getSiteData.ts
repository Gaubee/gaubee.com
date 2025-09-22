import { getCollection } from "astro:content";
import { generateMarkdownPreview } from "./markdownUtils";

export async function getSiteData() {
  const articles_raw = await getCollection("articles");
  const events_raw = await getCollection("events");

  const articles = articles_raw.map((p) => ({
    ...p,
    preview: generateMarkdownPreview(p.body),
  }));

  const events = events_raw.map((p) => ({
    ...p,
    preview: generateMarkdownPreview(p.body),
  }));

  const allPosts = [...articles, ...events].sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime(),
  );

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

  return { allPosts, postsByMonth, allTags };
}
