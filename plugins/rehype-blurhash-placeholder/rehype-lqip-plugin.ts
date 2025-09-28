// plugins/rehype-blurhash-placeholder/rehype-lqip-plugin.ts
import type { AstroIntegration, RehypePlugins } from "astro";
import { encode } from "blurhash";
import Debug from "debug";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_DIR } from "plugins/helper/dirs";
import sharp from "sharp";
import { getLocalImgs } from "../helper/get-local-imgs";

const log = Debug("astro-lqip");

// --- Blurhash 解码和编码逻辑 ---
const CHARACTERS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function decode83(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    value = value * 83 + CHARACTERS.indexOf(str[i]);
  }
  return value;
}

/**
 * 将完整的 Blurhash 字符串编码成一个单一的 BigInt
 */
function encodeBlurhashToBigInt(hash: string): bigint {
  const sizeFlag = decode83(hash[0]);
  const quantisedMaximumValue = decode83(hash[1]);

  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;

  const colors: [number, number, number][] = Array(numX * numY);
  // DC
  const dcValue = decode83(hash.substring(2, 6));
  colors[0] = [dcValue >> 16, (dcValue >> 8) & 255, dcValue & 255];
  // AC
  for (let i = 1; i < colors.length; i++) {
    const value = decode83(hash.substring(4 + i * 2, 6 + i * 2));
    colors[i] = [
      Math.floor(value / (19 * 19)),
      Math.floor(value / 19) % 19,
      value % 19,
    ];
  }

  // 使用 BigInt 进行打包，每个值占一个 "byte" (0-255)
  let packed: bigint = 0n;
  const B = 256n; // Base 256

  // 从后往前打包，这样在 CSS 中更容易解码
  for (let i = colors.length - 1; i >= 0; i--) {
    const [r, g, b] = colors[i];
    packed = packed * B + BigInt(b);
    packed = packed * B + BigInt(g);
    packed = packed * B + BigInt(r);
  }

  packed = packed * B + BigInt(quantisedMaximumValue);
  packed = packed * B + BigInt(sizeFlag);

  return packed;
}

// --- Rehype 插件 ---
export const rehypeLqip: RehypePlugins[number] = () => {
  return async (tree) => {
    const imageNodes = getLocalImgs(tree);

    for (const { imgSrc, imgFilepath, node, updateImageNode } of imageNodes) {
      const imgSrc = String(node.properties.src);
      const imgFilepath = path.join(PUBLIC_DIR, imgSrc);
      if (!existsSync(imgFilepath)) continue;

      try {
        const image = sharp(imgFilepath);
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height)
          throw new Error("Could not read image metadata");

        const blurhashString = await (async () => {
          const pixelData = await image
            .clone()
            .resize(32, 32, { fit: "fill" })
            .raw()
            .ensureAlpha()
            .toBuffer();
          // 4x3 是一个很好的平衡点
          return encode(new Uint8ClampedArray(pixelData), 32, 32, 4, 3);
        })();

        const lqipValue = encodeBlurhashToBigInt(blurhashString);

        const style = `aspect-ratio: ${metadata.width}/${metadata.height}; --lqip: ${lqipValue};`;

        node.properties.class =
          `${node.properties.class || ""} lqip-img`.trim();
        node.properties.style =
          `${node.properties.style || ""} ${style}`.trim();
        updateImageNode();
      } catch (error) {
        log(`Failed to process image ${imgSrc}:`, error);
      }
    }
  };
};

// --- Astro 集成 ---
export default function astroLqip(): AstroIntegration {
  return {
    name: "astro-lqip",
    hooks: {
      "astro:config:setup": ({ updateConfig, injectScript }) => {
        updateConfig({
          markdown: {
            rehypePlugins: [
              rehypeLqip,
              // 您可以在这里安全地链式调用 responsive images 插件
            ],
          },
        });

        const stylePath = path.resolve(
          fileURLToPath(import.meta.url),
          "../lqip.css",
        );
        injectScript("page-ssr", `import "${stylePath}";`);
      },
    },
  };
}
