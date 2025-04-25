import {func_remember} from '@gaubee/util';
import {Task} from '@lit/task';
import {html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('com-youtube-player')
export class ComYoutubePlayerElement extends LitElement {
  static youtubeApiIniter = func_remember(() => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    document.head.insertBefore(tag, firstScriptTag);
    type YoutubeApi = {
      Player: any;
      PlayerState: any;
    };
    return new Promise<YoutubeApi>((resolve, reject) => {
      (globalThis as any).onYouTubeIframeAPIReady = () => {
        resolve((globalThis as any).YT);
      };
      tag.onerror = reject;
    });
  });
  @property({type: String, reflect: true, attribute: true})
  accessor videoId: string = '';

  @property({type: Number, reflect: true, attribute: true})
  accessor width: number = 600;
  @property({type: Number, reflect: true, attribute: true})
  accessor height: number = 400;

  private __task = new Task(
    this,
    async (videoId) => {
      const YT = await ComYoutubePlayerElement.youtubeApiIniter();
      if (!videoId) {
        return;
      }
      // The API will call this function when the video player is ready.
      function onPlayerReady(event: any) {
        event.target.playVideo();
      }

      // The API calls this function when the player's state changes.
      // The function indicates that when playing a video (state=1),
      // the player should play for six seconds and then stop.
      let done = false;
      function onPlayerStateChange(event: any) {
        if (event.data == YT.PlayerState.PLAYING && !done) {
          setTimeout(stopVideo, 6000);
          done = true;
        }
      }
      function stopVideo() {
        player.stopVideo();
      }

      const player = new YT.Player(this, {
        height: this.height,
        width: this.width,
        videoId: videoId,
        playerVars: {
          playsinline: 1,
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
        },
      });
    },
    () => [this.videoId]
  );
  protected override render() {
    return html`<style>
        :host {
          display: block;
          width: ${this.width}px;
          height: ${this.height}px;
        }
      </style>
      <slot>
        ${this.__task.render({
          pending() {
            return html`<div>Loading...</div>`;
          },
        })}
      </slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'com-youtube-player': ComYoutubePlayerElement;
  }
}
