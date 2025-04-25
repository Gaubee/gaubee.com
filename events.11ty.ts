import page from './_includes/page.11ty.js';
import {EleventyData} from './_includes/types.js';
import {getAllEvents} from './database/events.controller.js';
export default async function (data: EleventyData) {
  const html = String.raw;
  data.title ??= `Gaubee Events`;
  const allEvents = await getAllEvents();
  return page({
    ...data,
    content: html`<style>
        .events {
          list-style: auto;
          display: flex;
          flex-direction: column-reverse;
          gap: 1rem;
        }
      </style>
      <nav class="events">
        ${allEvents
          .slice()
          .reverse()
          .map(
            (event) =>
              html`<li>
                <a href="${event.url}">${event.metadata.title}</a>
              </li>`
          )
          .join('\n')}
      </nav>`,
  });
}
