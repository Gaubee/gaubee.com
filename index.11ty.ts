import page from './_includes/page.11ty.js';
import {EleventyData} from './_includes/types.js';

export default function (data: EleventyData): string {
  const html = String.raw;
  data.title ??= `Gaubee Website`;
  return page({
    ...data,
    content: html`
      <style>
        .home > .banner {
          color: #e91e63;
          text-align: center;
        }
        @supports (-webkit-background-clip: text) {
          .home > .banner {
            background: -webkit-linear-gradient(#e91e63, #673ab7);
            color: transparent;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
        }
      </style>
      <main class="home">
        <h1 class="banner">Gaubee</h1>
        <h2 class="banner">An world developer.</h2>
        <h2 class="banner">love web.</h2>
        <h2 class="banner">love truth.</h2>
      </main>
    `,
  });
}
