import {matter, walkFiles} from '@gaubee/nodekit';
import {func_remember} from '@gaubee/util';
import path from 'node:path';
import {rootResolver} from './common.helper.ts';
import {markdownToHtml} from './markdown.helper.ts';
const articlesDirname = rootResolver('./articles');

export const getAllArticles = Object.assign(
  func_remember(async () => {
    return (
      await Promise.all(
        [...walkFiles(articlesDirname)].map(async (entry) => {
          if (!(entry.path.endsWith('.md') || entry.path.endsWith('.mdx'))) {
            return;
          }
          const info = matter(entry.readText());
          const id = path.parse(entry.name).name;
          const title = info.data.title || id;
          const createdAt = new Date(info.data.date || entry.stats.birthtimeMs);
          const updatedAt = new Date(info.data.updated || entry.stats.ctimeMs);
          const tags = Array.isArray(info.data.tags) ? (info.data.tags as string[]) : [];
          return {
            url: `/articles/${id}/`,
            fileEntry: entry,
            originMetadata: info.data,
            metadata: {...info.data, id, title, createdAt, updatedAt, tags},
            htmlContent: func_remember(() =>
              markdownToHtml(info.content, {
                filepath: entry.path,
              })
            ),
            markdownContent: info.content,
          };
        })
      )
    )
      .filter((it) => it !== undefined)
      .sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime() || b.fileEntry.name.localeCompare(a.fileEntry.name));
  }),
  {
    watch: func_remember(() => {
      return {};
    }),
  }
);

export type ArticleItem = Awaited<ReturnType<typeof getAllArticles>>[number];

// if (isDev) {
//   const resetCache = func_debounce(() => {
//     console.log('getAllArticles reseted');
//     getAllArticles.reset();
//   }, 200);
//   fs.watch(articlesDirname, {recursive: true}, () => {
//     resetCache();
//   });
// }
