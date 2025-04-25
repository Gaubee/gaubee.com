import footer from './footer.11ty.js';
import header from './header.11ty.js';
import nav from './nav.11ty.js';

import root from './root.11ty.js';
import type {EleventyData} from './types.js';

export default function (data: EleventyData): string {
  const html = String.raw;
  return root({
    ...data,
    content: html`${header(data, {default: nav(data)})}
      <div id="main-wrapper">
        <main>${data.content}</main>
      </div>
      ${footer(data)}`,
  });
}
