import {map_get_or_put} from '@gaubee/util';
import page from './_includes/page.11ty.js';
import {EleventyData} from './_includes/types.js';
import {ArticleItem, getAllArticles} from './database/articles.controller.js';
import {EventItem, getAllEvents} from './database/events.controller.js';
import {markdownToHtml} from './database/markdown.helper.js';

export default async function (data: EleventyData) {
  const html = String.raw;
  data.links = ['/timeline.css'];
  data.scripts = ['/bundle/index.js'];
  data.title = `Gaubee Timeline`;
  const allData = await getAllData();
  return page({
    ...data,
    content: allData
      .map(
        ({year, items}) => html`
          <h2>${year}年</h2>
          <section>
            ${items
              .map((item) => {
                if (item.type === 'article') {
                  const articleData = item.article;
                  return html`
                    <div class="article">
                      <h3 class="title">
                        <a href="${articleData.url}">${articleData.metadata.title}</a>
                      </h3>
                      <article>${item.previewContent}</article>
                    </div>
                  `;
                } else {
                  return html`<div class="event">${item.previewContent}</div>`;
                }
              })
              .join('')}
          </section>
        `
      )
      .join(''),
  });
}

const getAllData = async () => {
  const articles = await getAllArticles();
  const events = await getAllEvents();
  const years = new Map<
    number,
    Array<
      | {
          type: 'article';
          createdAt: Date;
          previewContent: string;
          article: ArticleItem;
        }
      | {
          type: 'event';
          createdAt: Date;
          previewContent: string;
          event: EventItem;
        }
    >
  >();
  for (const article of articles) {
    map_get_or_put(years, article.metadata.createdAt.getFullYear(), () => []).push({
      type: 'article',
      createdAt: article.metadata.createdAt,
      article,
      previewContent: await markdownToHtml(article.markdownContent.split('\n').slice(0, 20).join('\n'), {filepath: article.fileEntry.path}),
    });
  }
  for (const event of events) {
    map_get_or_put(years, event.metadata.createdAt.getFullYear(), () => []).push({
      type: 'event',
      createdAt: event.metadata.createdAt,
      previewContent: await event.htmlContent(),
      event,
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
