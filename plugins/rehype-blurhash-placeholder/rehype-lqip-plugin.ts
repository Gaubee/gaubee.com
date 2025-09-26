// plugins/rehype-blurhash-placeholder/rehype-lqip-plugin.ts
import { cn } from "../../src/lib/utils";
import { createResolverByRootFile } from "@gaubee/nodekit";
import type { AstroIntegration, RehypePlugins } from "astro";
import { encode } from "blurhash";
import Debug from "debug";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getLocalImgs } from "../helper/get-local-imgs";

const log = Debug("rehype-lqip-plugin");

const rootResolver = createResolverByRootFile(import.meta.url);
const PUBLIC_NAME = "public";
const PUBLIC_DIR = rootResolver(PUBLIC_NAME);

// --- Blurhash 解码器 ---
const CHARACTERS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
function decode83(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    value = value * 83 + CHARACTERS.indexOf(str[i]);
  }
  return value;
}

// --- Rehype 插件逻辑 ---
export const rehypeLqip: RehypePlugins[number] = () => {
  return async (tree) => {
    // 1. 收集所有需要处理的图片节点
    const imageNodes = getLocalImgs(PUBLIC_DIR, tree);

    for (const { node, imgFilepath, imgSrc, updateImgeNode } of imageNodes) {
      try {
        const image = sharp(imgFilepath);
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height)
          throw new Error("Could not read image metadata");

        const blurhashString = await (async () => {
          const pixelData = await image
            .clone()
            .resize(20, 20, { fit: "inside" })
            .raw()
            .ensureAlpha()
            .toBuffer();
          return encode(new Uint8ClampedArray(pixelData), 20, 20, 4, 3);
        })();

        // --- 核心编码逻辑 ---
        const sizeFlag = decode83(blurhashString[0]);
        const dcValue = decode83(blurhashString.substring(2, 6));
        // 将 sizeFlag 和 dcValue 编码到一个单一的负整数中
        const encodedLqip = -(sizeFlag * 16777216 + dcValue);
        // --- 编码结束 ---

        log(`[${imgSrc}] LQIP encoded: ${encodedLqip}`);

        const style = `aspect-ratio: ${metadata.width}/${metadata.height}; --lqip: ${encodedLqip};`;

        node.properties.class = cn(node.properties.class, "lqip-img");

        node.properties.style =
          `${node.properties.style || ""} ${style}`.trim();

        updateImgeNode();
      } catch (error) {
        log(`Failed to process image ${imgSrc}:`, error);
      }
    }
  };
};

// --- Astro 集成定义 ---
export function astroLqip(): AstroIntegration {
  return {
    name: "astro-lqip",
    hooks: {
      "astro:config:setup": ({ updateConfig, injectScript }) => {
        // 1. 注入 Rehype 插件
        updateConfig({
          markdown: {
            rehypePlugins: [
              rehypeLqip,
              // 这里依然可以链式调用您的响应式图片插件
              // import { rehypeResponsiveImages } from '...';
              // rehypeResponsiveImages,
            ],
          },
        });

        // 2. 注入全局 CSS
        const stylePath = path.resolve(
          fileURLToPath(import.meta.url),
          "../lqip.css",
        );
        injectScript("page-ssr", `import "${stylePath}";`);
      },
    },
  };
}
