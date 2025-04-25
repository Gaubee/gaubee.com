import type {EleventyData, Slots} from './types.js';

export default function (data: EleventyData, slots: Slots<'default'> = {}): string {
  const html = String.raw;
  return html`<header class="bg-ani">${slots.default ?? ''}</header>`;
}
