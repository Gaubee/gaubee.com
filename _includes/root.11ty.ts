import {getComponentsEntry} from '../scripts/custom-elements-metadata.js';
import {relativePath as relative} from './relative-path.js';

import type {EleventyData} from './types.js';
declare global {
  var useVite: boolean;
}
export default function (data: EleventyData): string {
  const html = String.raw;
  const {title, page, tags, description, content, scripts, links} = data;
  const safeUrl = (url: string) => relative(page.url, url);
  const polyfill = '';

  // html` <link href="${safeUrl('/prism-okaidia.css')}" rel="stylesheet" />
  //   <script src="${safeUrl('/node_modules/@webcomponents/webcomponentsjs/webcomponents-loader.js')}"></script>
  //   <script src="${safeUrl('/node_modules/lit/polyfill-support.js')}"></script>`;
  return html` <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="description" content="${description ?? ''}" />
        <meta name="keywords" content="${['Appn', 'WebComponent', tags].flat().filter(Boolean).join(', ') ?? ''}" />
        <meta name="author" content="Gaubee, gaubeebangeel@gmail.com" />

        <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0" />
        <title>${title}</title>
        <link rel="shortcut icon" href="${safeUrl('/favicon.ico')}" />
        <link rel="stylesheet" href="${safeUrl('/index.css')}" />
        ${polyfill} ${scripts?.map((script_src) => html`<script type="module" src=${script_src}></script>`).join('') ?? ''}
        ${links?.map((link_href) => html`<link rel="stylesheet" href=${link_href} />`) ?? ''}
        ${getComponentsEntry()
          .map((entry) => {
            return html`<script type="module" src="${entry.bundle}"></script>`;
          })
          .join('\n')}
      </head>
      <body>
        ${content}
      </body>
    </html>`;
}
