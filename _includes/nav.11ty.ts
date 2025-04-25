import type {EleventyData} from './types.js';

export default function ({page}: EleventyData): string {
  const html = String.raw;
  const first_schema = page.url.slice(1).split('/').shift() || 'index';
  return html` <style>
      .nav {
        padding: 0 2em;
        border-radius: 2em;
        backdrop-filter: contrast(0.5) brightness(2);
        width: fit-content;
        max-width: 100%;
      }
      .nav {
        display: grid;
        grid-template-columns: repeat(auto-fit, 180px);
        justify-content: center;
        gap: 12px;
      }

      .nav > a {
        display: block;
        flex: 1;
        font-size: 18px;
        padding: 16px;
        text-align: center;
      }
      .nav > a {
        color: #e91e63;
      }
      @supports (-webkit-background-clip: text) {
        .nav > a {
          background: -webkit-linear-gradient(#e91e63, #673ab7);
          color: transparent;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
      }
    </style>
    <nav class="nav">
      <a class="${first_schema === 'index' ? 'target' : ''}" href="/">Home</a>
      <a class="${first_schema === 'articles' ? 'target' : ''}" href="/articles/">Articles</a>
      <a class="${first_schema === 'events' ? 'target' : ''}" href="/events/">Events</a>
      <a class="${first_schema === 'timeline' ? 'target' : ''}" href="/timeline/">Timeline</a>
      <a class="${first_schema === 'projects' ? 'target' : ''}" href="/projects/">Projects</a>
    </nav>`;
}
