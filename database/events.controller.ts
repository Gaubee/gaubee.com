import {walkFiles} from '@gaubee/nodekit';
import {func_remember} from '@gaubee/util';
import matter from 'gray-matter';
import path from 'node:path';
import {match, P} from 'ts-pattern';
import {rootResolver} from './common.helper.ts';
import {markdownToHtml} from './markdown.helper.ts';

export const getAllEvents = func_remember(async () => {
  const eventsDirname = rootResolver('./events');
  return (
    await Promise.all(
      [...walkFiles(eventsDirname)].map(async (entry) => {
        if (!(entry.path.endsWith('.md') || entry.path.endsWith('.mdx'))) {
          return;
        }
        const info = matter(entry.readText());
        const createdAt = new Date(info.data.date || entry.stats.birthtimeMs);
        const tags = Array.isArray(info.data.tags) ? (info.data.tags as string[]) : [];
        const name = path.parse(entry.name).name;
        const title = match(info.data.title)
          .with(P.string.minLength(1), (title) => title)
          .otherwise(() => name.split('.')[1].replaceAll('-', ' '));
        return {
          url: `/events/${name}/`,
          fileEntry: entry,
          originMetadata: info.data,
          metadata: {...info.data, createdAt, tags, title},
          markdownContent: info.content,
          htmlContent: func_remember(() =>
            markdownToHtml(info.content, {
              filepath: entry.path,
            })
          ),
        };
      })
    )
  )
    .filter((it) => it !== undefined)
    .sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime() || b.fileEntry.name.localeCompare(a.fileEntry.name));
});
