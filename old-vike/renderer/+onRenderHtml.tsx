// https://vike.dev/onRenderHtml
export {onRenderHtml};

import ReactDOMServer from 'react-dom/server';
import {dangerouslySkipEscape, escapeInject as html} from 'vike/server';
import type {OnRenderHtmlAsync} from 'vike/types';
import {getPageTitle} from './getPageTitle.ts';
import {Layout} from './Layout.tsx';

const onRenderHtml: OnRenderHtmlAsync = async (pageContext): ReturnType<OnRenderHtmlAsync> => {
  const {Page} = pageContext;

  // This onRenderHtml() hook only supports SSR, see https://vike.dev/render-modes for how to modify
  // onRenderHtml() to support SPA
  if (!Page) throw new Error('My onRenderHtml() hook expects pageContext.Page to be defined');

  // Alternatively, we can use an HTML stream, see https://vike.dev/streaming
  const pageHtml = ReactDOMServer.renderToString(
    <Layout pageContext={pageContext}>
      <Page />
    </Layout>
  );

  const title = getPageTitle(pageContext);
  const desc = pageContext.data?.description || pageContext.config.description || "Gaubee's Blogs / Events / Projects";

  const documentHtml = html`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <link rel="icon" href="/img/head.webp" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="${desc}" />
        <title>${title}</title>
      </head>
      <body>
        <div id="root">${dangerouslySkipEscape(pageHtml)}</div>
      </body>
    </html>`;

  return {
    documentHtml,
    pageContext: {
      // We can add custom pageContext properties here, see https://vike.dev/pageContext#custom
    },
  };
};
