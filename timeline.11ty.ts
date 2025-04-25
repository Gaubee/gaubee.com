import {map_get_or_put} from '@gaubee/util';
import page from './_includes/page.11ty.js';
import {EleventyData} from './_includes/types.js';
import {getAllArticles} from './database/articles.controller.js';
import {getAllEvents} from './database/events.controller.js';
import {markdownToHtml} from './database/markdown.helper.js';

export default async function (data: EleventyData) {
  const html = String.raw;
  data.links = ['/timeline.css'];
  data.title = `Gaubee Timeline`;
  const allData = await getAllData();
  return page({
    ...data,
    content: (
      await Promise.all(
        allData.map(
          async ({year, items}) => html`
            <h2>${year}年</h2>
            <section>
              ${(
                await Promise.all(
                  items.map(async (item) => {
                    if (item.type === 'article') {
                      const articleData = item.data;
                      return html`
                        <div class="article">
                          <h3 class="title">
                            <a href="/article/${encodeURIComponent(articleData.id)}/">${articleData.title}</a>
                          </h3>
                          <article>${articleData.previewContent}</article>
                        </div>
                      `;
                    } else {
                      // 确保类型安全 (如果 TypeScript 配置严格)
                      const eventData = item.data;
                      return html` <div class="event">${await eventData.htmlContent()}</div> `;
                    }
                  })
                )
              ).join('')}
            </section>
          `
        )
      )
    ).join(''),
  });
}

const getAllData = async () => {
  const articles = await getAllArticles();
  const events = await getAllEvents();
  type Articles = (typeof articles)[number];
  type Event = (typeof events)[number];
  const years = new Map<
    number,
    Array<
      | {
          type: 'article';
          createdAt: Date;
          data: Articles['metadata'] & {previewContent: string};
        }
      | {
          type: 'event';
          createdAt: Date;
          data: Event;
        }
    >
  >();
  for (const article of articles) {
    map_get_or_put(years, article.metadata.createdAt.getFullYear(), () => []).push({
      type: 'article',
      createdAt: article.metadata.createdAt,
      data: {
        ...article.metadata,
        previewContent: await markdownToHtml(article.markdownContent.split('\n').slice(0, 20).join('\n'), {filepath: article.fileEntry.path}),
      },
    });
  }
  for (const event of events) {
    map_get_or_put(years, event.metadata.createdAt.getFullYear(), () => []).push({
      type: 'event',
      createdAt: event.metadata.createdAt,
      data: event,
    });
  }
  const data = [...years]
    .map(([year, items]) => {
      return {
        year,
        items: items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      };
    })
    .sort((a, b) => b.year - a.year);
  return data;
};
