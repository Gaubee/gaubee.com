type DateTimeFormatters = {
  text: Intl.DateTimeFormat;
  title: Intl.DateTimeFormat;
};
class DateTimeFormatFactory {
  private _cache = new Map<string, DateTimeFormatters>();
  private _genFormatter(locales: string): DateTimeFormatters {
    const textformatter = new Intl.DateTimeFormat(locales, {
      dateStyle: 'full',
      timeStyle: 'short',
    });
    const titleformatter = new Intl.DateTimeFormat(locales, {
      dateStyle: 'full',
      timeStyle: 'full',
    });
    return {text: textformatter, title: titleformatter};
  }
  getFormatter(locales: string) {
    const key = locales;
    let formatters = this._cache.get(key);
    if (formatters === undefined) {
      formatters = this._genFormatter(locales);
      this._cache.set(key, formatters);
    }
    return formatters;
  }
}
const dateTimeFormatFactory = new DateTimeFormatFactory();

export class LocalTimeElement extends HTMLElement {
  static get observedAttributes() {
    return ['datetime', 'locales'];
  }
  locales = navigator.language;
  date = new Date();
  attributeChangedCallback(attrName: string, _oldValue: string, newValue: string) {
    if (attrName === 'datetime') {
      const millis = Date.parse(newValue);
      if (isNaN(millis)) {
        return;
      }
      this.date = new Date(millis);
    }
    this._doEffectAttributes();
  }
  private _effect_lock = false;
  private _doEffectAttributes() {
    if (this._effect_lock) {
      return;
    }
    this._effect_lock = true;
    queueMicrotask(() => {
      const formattters = dateTimeFormatFactory.getFormatter(this.locales);
      this.textContent = formattters.text.format(this.date);
      this.title = formattters.title.format(this.date);
      this._effect_lock = false;
    });
  }
}
if (!window.customElements.get('local-time')) {
  Reflect.set(window, 'LocalTimeElement', LocalTimeElement);
  window.customElements.define('local-time', LocalTimeElement);
}

declare global {
  interface Window {
    LocalTimeElement: typeof LocalTimeElement;
  }
  interface HTMLElementTagNameMap {
    'local-time': LocalTimeElement;
  }
}
