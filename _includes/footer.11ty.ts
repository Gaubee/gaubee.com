import type {EleventyData} from './types.js';

export default function (data: EleventyData): string {
  const html = String.raw;
  return html` <style>
      footer a {
        line-height: 1;
      }
      footer nav {
        display: flex;
        gap: 1rem;
      }
    </style>
    <footer class="bg-ani">
      <nav>
        <a target="_blank" href="https://github.com/gaubee/gaubee.com">Github</a>
        <a target="_blank" href="https://beian.miit.gov.cn/#/Integrated/recordQuery">闽ICP备17026139号-1</a>
      </nav>
    </footer>`;
}
