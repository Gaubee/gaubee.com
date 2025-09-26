import { createResolverByRootFile } from "@gaubee/nodekit";
import type { RehypePlugins } from "astro";
import { encode } from "blurhash";
import Debug from "debug";
import type { Element, Root } from "hast";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { visit } from "unist-util-visit";
import { blurhashToCss } from "./blurhash-to-css";

const log = Debug("rehype-blurhash-placeholder");
const rootResolver = createResolverByRootFile(import.meta.url);

const PUBLIC_NAME = "public";
const PUBLIC_DIR = rootResolver(PUBLIC_NAME);

/**
 * Astro Rehype 插件，用于生成 CSS-only Blurhash 占位符并创建容器
 */
export const rehypeBlurhashPlaceholder: RehypePlugins[number] = () => {
  return async (tree, file) => {
    const imageNodes: {
      node: Element;
      index: number;
      parent: Root | Element;
    }[] = [];

    visit(tree, "element", (node, index, parent) => {
      if (
        index != null &&
        parent != null &&
        node.tagName === "img" &&
        node.properties?.src &&
        !String(node.properties.src).startsWith("http")
      ) {
        imageNodes.push({ node, index, parent });
      }
    });

    if (imageNodes.length === 0) return;

    for (const { node, index, parent } of imageNodes) {
      const imgSrc = String(node.properties.src);
      const imgFilepath = path.join(PUBLIC_DIR, imgSrc);

      if (!existsSync(imgFilepath)) {
        log(`图片未找到，已跳过: ${imgFilepath}`);
        continue;
      }

      try {
        const image = sharp(imgFilepath);
        const metadata = await image.metadata();

        if (!metadata.width || !metadata.height) {
          throw new Error(`无法读取图片尺寸: ${imgSrc}`);
        }

        // 1. 生成 Blurhash 字符串
        const blurhashString = await (async () => {
          const clampedWidth = 100;
          const clampedHeight = Math.round(
            (clampedWidth / metadata.width!) * metadata.height!,
          );
          const pixelData = await image
            .clone()
            .resize(clampedWidth, clampedHeight)
            .raw()
            .ensureAlpha()
            .toBuffer();
          return encode(
            new Uint8ClampedArray(pixelData),
            clampedWidth,
            clampedHeight,
            4,
            3,
          );
        })();
        log(`[${imgSrc}] 生成 Blurhash: ${blurhashString}`);

        // 2. 将 Blurhash 转换为 CSS
        const cssPlaceholder = blurhashToCss(blurhashString);

        // -- 从这里开始修改 --
        let placeholderStyle = `aspect-ratio: ${metadata.width}/${metadata.height};`;
        if ("background-image" in cssPlaceholder) {
          placeholderStyle += ` background: ${cssPlaceholder["background-image"]};`;
          placeholderStyle += ` background-position: ${cssPlaceholder["background-position"]};`;
          placeholderStyle += ` background-size: ${cssPlaceholder["background-size"]};`;
          placeholderStyle += ` background-repeat: ${cssPlaceholder["background-repeat"]};`;
        }
        // -- 修改结束 --

        // 3. 创建容器 <div>
        const containerNode: Element = {
          type: "element",
          tagName: "div",
          properties: {
            class: "image-placeholder-container",
            style: placeholderStyle, // 使用新的样式字符串
          },
          // 将原始的 <img> 节点作为其子节点
          children: [node],
        };

        // 4. 用新的容器节点替换原始的 <img> 节点
        parent.children.splice(index, 1, containerNode);
      } catch (error) {
        log(`处理图片失败: ${imgSrc}`, error);
      }
    }
  };
};
