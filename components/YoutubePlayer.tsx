'use client';
import {func_remember} from '@gaubee/util';
import React from 'react';
import {type FC} from 'react';

const youtubeApiIniter = func_remember(() => {
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
  });
});

export const YoutubePlayer: FC<{
  videoId: string;
  width?: number;
  height?: number;
}> = ({videoId, width = 640, height = 390}) => {
  'use client';
  return (
    <div
      ref={(ele) => {
        console.log('ele', ele);
        if (ele) {
          (async () => {
            const YT = await youtubeApiIniter();
            const player = new YT.Player(ele, {
              height: height,
              width: width,
              videoId: videoId,
              playerVars: {
                playsinline: 1,
              },
              events: {
                onReady: onPlayerReady,
                onStateChange: onPlayerStateChange,
              },
            });
            // 4. The API will call this function when the video player is ready.
            function onPlayerReady(event: any) {
              event.target.playVideo();
            }

            // 5. The API calls this function when the player's state changes.
            //    The function indicates that when playing a video (state=1),
            //    the player should play for six seconds and then stop.
            var done = false;
            function onPlayerStateChange(event: any) {
              if (event.data == YT.PlayerState.PLAYING && !done) {
                setTimeout(stopVideo, 6000);
                done = true;
              }
            }
            function stopVideo() {
              player.stopVideo();
            }
          })();
        }
      }}
      id="video-player"
    ></div>
  );
};
