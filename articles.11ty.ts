import page from './_includes/page.11ty.js';
import {EleventyData} from './_includes/types.js';
import {getAllArticles} from './database/articles.controller.js';

export default async function (data: EleventyData) {
  const html = String.raw;
  data.title ??= `Gaubee Articles`;
  const allArticles = await getAllArticles();
  return page({
    ...data,
    content: html`<style>
        .articles {
          list-style: auto;
          display: flex;
          flex-direction: column-reverse;
          gap: 1rem;
        }
      </style>
      <nav class="articles">
        ${allArticles
          .slice()
          .reverse()
          .map((article) => html`<li><a href="${article.url}">${article.metadata.title}</a></li>`)
          .join('\n')}
      </nav>`,
  });
}
