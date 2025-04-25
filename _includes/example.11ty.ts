import page from './page.11ty.js';
import {relativePath as relative} from './relative-path.js';


import {escapeHTML} from 'es-escape-html';
import type {EleventyData, EleventyExampleData} from './types.js';

export default function (data: EleventyExampleData): string {
  data.tags ??= ['example'];
  data.title ??= `Appn Example: ${data.name}`;
  return page({
    ...data,
    content: renderExample(data),
  });
}

const renderExample = (data: EleventyExampleData): string => {
  const {name, content, showNav} = data;
  const html = String.raw;
  const css = String.raw;

  const layoutStyles = {
    gap: 16,
    left: 240,
    totalMin: 600,
    get rightMin() {
      return this.totalMin - this.gap - this.left;
    },
  };
  const style = showNav
    ? css`
        section.examples {
          display: grid;
          grid-template-columns: 1fr;
          grid-gap: ${layoutStyles.gap}px;
          justify-content: center;
        }
        section.examples > .content {
          max-width: 100%;
          overflow: auto;
        }
        @container (min-width: ${layoutStyles.totalMin}px) {
          section.examples {
            grid-template-columns: ${layoutStyles.left}px minmax(${layoutStyles.rightMin}px, 1f);
          }
        }
        @container (min-width: ${layoutStyles.totalMin}px) {
          section.examples > .content {
            padding-inline-start: 16px;
            padding-block-end: 16px;
            border-inline-start: 1px solid #efefef;
          }
        }
      `
    : css`
        section.examples {
          min-width: ${layoutStyles.totalMin}px;
        }
        section.examples > .content {
          padding-inline: 16px;
          padding-block-end: 16px;
        }
      `;

  return html`
    <style>
      ${style}
    </style>
    <section class="examples">
      ${showNav ? renderExampleNav(data) : ''}
      <div class="content">
        <h2>Example: ${name}</h2>
        ${content}
      </div>
    </section>
  `;
};
export const renderExampleNav = ({page, collections}: EleventyData, showNavDescription = false): string => {
  const html = String.raw;
  const css = String.raw;
  const style = css`
    nav.collection {
      border: none;
      height: fit-content;
      border-bottom: 1px solid #efefef;
      justify-content: flex-start;
    }

    /* nav.collection > ul {
      padding: 0;
      list-style: square;
    } */

    nav.collection > li {
      padding: 4px 0;
    }

    nav.collection > li.selected {
      font-weight: 600;
    }
    .example-link {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
    }
  `;
  return html` <style>
      ${style}
    </style>
    <h2>Examples</h2>
    <nav class="collection">
      ${collections?.example
        ?.map(
          (post) => html`
            <li class="${post.url === page.url ? 'selected' : ''}">
              <div class="example-link">
                <a href="${relative(page.url, post.url)}"> ${escapeHTML(post.data.name ?? '')} </a>
                ${showNavDescription ? html`<p>${escapeHTML(post.data.description ?? '')}</p>` : ''}
              </div>
            </li>
          `
        )
        .join('') ?? ''}
    </nav>`;
};
