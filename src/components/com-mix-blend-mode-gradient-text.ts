import { html, LitElement, type PropertyValues } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("com-mix-blend-mode-gradient-text")
export class ComMixBlendModeGradientTextElement extends LitElement {
  private demo!: HTMLDivElement;

  private bindInputColor = (
    selector: string,
    cssProperty: string,
    defaultValue: string,
  ) => {
    const ele = this.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
    ele.oninput = () => this.demo.style.setProperty(cssProperty, ele.value);
    ele.value = defaultValue;
    ele.dispatchEvent(new Event("input"));
  };

  protected override firstUpdated(_changedProperties: PropertyValues): void {
    super.firstUpdated(_changedProperties);
    this.demo = this.shadowRoot!.querySelector<HTMLDivElement>("#demo")!;
    this.bindInputColor("#bg-color", "--background-color", "#ffffff");
    this.bindInputColor("#start-color", "--gradient-color-start", "#1f00ff");
    this.bindInputColor("#end-color", "--gradient-color-end", "#ff0000");
  }

  protected override render() {
    return html`<main id="demo">
      <div id="text-container">
        <div class="gradient-text">
          SOME
          <svg
            class="icon"
            style="width: 1em;height: 1em;vertical-align: middle;fill: currentColor;overflow: hidden;"
            viewBox="0 0 1024 1024"
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            p-id="8288"
          >
            <path
              d="M512 0C230.4 0 0 230.4 0 512s230.4 512 512 512 512-230.4 512-512S793.6 0 512 0z m0 939.2c-235.2 0-427.2-192-427.2-427.2S276.8 84.8 512 84.8s427.2 192 427.2 427.2-192 427.2-427.2 427.2zM320 363.2m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0ZM704 363.2m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0ZM734.4 555.2H289.6c-17.6 0-33.6 8-46.4 20.8s-17.6 33.6-12.8 51.2C256 763.2 376 857.6 512 857.6s256-97.6 281.6-230.4c4.8-17.6 0-33.6-12.8-51.2-12.8-12.8-30.4-20.8-46.4-20.8zM512 772.8c-84.8 0-161.6-56-187.2-132.8H704c-30.4 81.6-107.2 132.8-192 132.8z"
              p-id="8289"
            ></path>
          </svg>
          TEXT
        </div>
      </div>
      <div class="controllers">
        <fieldset>
          <legend>背景色 Background Color</legend>
          <input id="bg-color" type="color" />
        </fieldset>
        <fieldset>
          <legend>渐变色 Gradient Color</legend>
          <label for="start-color">开始色 Start Color</label>
          <input id="start-color" type="color" />
          <label for="end-color">结束色 End Color</label>
          <input id="end-color" type="color" />
        </fieldset>
      </div>
      <style>
        #demo {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        #text-container {
          --gradient-color: linear-gradient(
            45deg,
            var(--gradient-color-start),
            var(--gradient-color-end)
          );
          background-color: var(--background-color);
          font-size: 3em;
          font-weight: bold;
          display: inline-block;
        }
        #text-container .gradient-text {
          display: flex;
          align-items: center;
        }
        #text-container .gradient-text {
          background: var(--gradient-color);
          color: var(--background-color);
          position: relative;
          mix-blend-mode: difference;
        }
        #text-container .gradient-text::before {
          content: " ";
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: inherit;
          mix-blend-mode: difference;
          pointer-events: none;
        }
        .controllers {
          display: flex;
          justify-content: space-around;
          flex-wrap: wrap;
          width: 100%;
        }
        .controllers fieldset {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        }
      </style>
    </main>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "com-mix-blend-mode-gradient-text": ComMixBlendModeGradientTextElement;
  }
}
