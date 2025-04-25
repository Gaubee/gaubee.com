import ExtendedTimeElement from './extended-time-element';
import RelativeTime from './relative-time';
import {localeFromElement} from './utils';

export class RelativeTimeElement extends ExtendedTimeElement {
  override getFormattedDate(): string | undefined {
    const date = this.date;
    if (!date) return;
    return new RelativeTime(date, localeFromElement(this)).toString();
  }

  override connectedCallback(): void {
    nowElements.push(this);

    if (!updateNowElementsId) {
      updateNowElements();
      updateNowElementsId = window.setInterval(updateNowElements, 60 * 1000);
    }
    super.connectedCallback();
  }

  disconnectedCallback(): void {
    const ix = nowElements.indexOf(this);
    if (ix !== -1) {
      nowElements.splice(ix, 1);
    }

    if (!nowElements.length) {
      if (updateNowElementsId) {
        clearInterval(updateNowElementsId);
        updateNowElementsId = null;
      }
    }
  }
}

// Internal: Array tracking all elements attached to the document that need
// to be updated every minute.
const nowElements: RelativeTimeElement[] = [];

// Internal: Timer ID for `updateNowElements` interval.
let updateNowElementsId: number | null;

// Internal: Install a timer to refresh all attached relative-time elements every
// minute.
function updateNowElements() {
  for (const time of nowElements) {
    time.textContent = time.getFormattedDate() || '';
  }
}

// Public: RelativeTimeElement constructor.
//
//   var time = new RelativeTimeElement()
//   # => <relative-time></relative-time>
//
if (!window.customElements.get('relative-time')) {
  window.RelativeTimeElement = RelativeTimeElement;
  window.customElements.define('relative-time', RelativeTimeElement);
}

declare global {
  interface Window {
    RelativeTimeElement: typeof RelativeTimeElement;
  }
  interface HTMLElementTagNameMap {
    'relative-time': RelativeTimeElement;
  }
}
