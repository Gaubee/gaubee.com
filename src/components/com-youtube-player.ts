import { func_remember } from "@gaubee/util/func";
import { Task } from "@lit/task";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("com-youtube-player")
export class ComYoutubePlayerElement extends LitElement {
  static youtubeApiIniter = func_remember(() => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName("script")[0];
    document.head.insertBefore(tag, firstScriptTag);

    type YoutubeApi = {
      Player: any;
      PlayerState: any;
    };

    return new Promise<YoutubeApi>((resolve, reject) => {
      (window as any).onYouTubeIframeAPIReady = () => {
        resolve((window as any).YT);
      };
      tag.onerror = reject;
    });
  });

  @property({ type: String, reflect: true, attribute: "videoId" })
  videoId: string = "";

  @property({ type: Number, reflect: true })
  width: number = 600;

  @property({ type: Number, reflect: true })
  height: number = 400;

  private _task = new Task(
    this,
    async ([videoId]) => {
      if (!videoId) {
        return undefined;
      }
      const YT = await ComYoutubePlayerElement.youtubeApiIniter();

      function onPlayerReady() {
        // Autoplay is removed.
      }

      const player = new YT.Player(
        this.renderRoot.querySelector("#player-container"),
        {
          height: this.height,
          width: this.width,
          videoId: videoId,
          playerVars: {
            playsinline: 1,
          },
          events: {
            onReady: onPlayerReady,
          },
        },
      );
      return player;
    },
    () => [this.videoId],
  );

  protected override render() {
    return html`
      <style>
        :host {
          display: block;
          width: ${this.width}px;
          height: ${this.height}px;
        }
        #player-container {
          width: 100%;
          height: 100%;
        }
      </style>
      ${this._task.render({
        pending: () => html`<div>Loading YouTube Player...</div>`,
        complete: () => html`<div id="player-container"></div>`,
        error: (e) => html`<p>Error loading player: ${e}</p>`,
      })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "com-youtube-player": ComYoutubePlayerElement;
  }
}
