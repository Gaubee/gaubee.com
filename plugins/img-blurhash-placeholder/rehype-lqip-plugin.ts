// plugins/rehype-blurhash-placeholder/rehype-lqip-plugin.ts
import { readJson, writeJson } from "@gaubee/nodekit";
import type { PromiseMaybe } from "@gaubee/util";
import type { RehypePlugins } from "astro";
import Debug from "debug";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { rootResolver } from "../helper/dirs";
import { getFileHash } from "../helper/filehash";
import { getLocalImgs } from "../helper/get-local-imgs";
import { analyzeImage, getImageLQIP, type ImageInfo } from "./lqip";

const log = Debug("astro-lqip");
// 缓存目录
const CACHE_DIR = rootResolver(
  "node_modules/.astro/cache/rehype-blurhash-placeholder",
);
mkdirSync(CACHE_DIR, { recursive: true });

// --- Rehype 插件 ---
export const rehypeLqip: RehypePlugins[number] = () => {
  return async (tree) => {
    const imageNodes = getLocalImgs(tree);

    for (const { imgFilepath, node, updateImageNode } of imageNodes) {
      const imageHash = await getFileHash(imgFilepath);
      const imageCacheFile = path.join(CACHE_DIR, imageHash);
      const imgInfo = await readJson<PromiseMaybe<ImageInfo>>(
        imageCacheFile,
        async () => {
          const imgInfo = await analyzeImage(readFileSync(imgFilepath));
          writeJson(imageCacheFile, imgInfo);
          return imgInfo;
        },
      );
      const lqip = getImageLQIP(imgInfo);

      node.properties.width = `${imgInfo.width}`;
      node.properties.height = `${imgInfo.height}`;
      if (lqip != null) {
        node.properties.style = `--lqip:${lqip};${node.properties.style || ""}`;
      }
      updateImageNode();
    }
  };
};


