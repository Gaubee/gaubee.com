import type { RehypePlugins } from "astro";
import Debug from "debug";
import type { Element } from "hast";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getLocalImgs } from "../helper/get-local-imgs";

const log = Debug("astro-photoswipe");
const PROJECT_ROOT = process.cwd();

// --- 内联 Rehype 插件 ---
export const rehypePhotoSwipe: RehypePlugins[number] = () => {
  return async (tree) => {
    const imageNodes = getLocalImgs(tree);

    for (const { imgSrc: originalSrc, node, updateImageNode } of imageNodes) {
      if (!originalSrc || typeof originalSrc !== "string") continue;

      const imgFilepath = path.join(PROJECT_ROOT, "public", originalSrc);
      if (!existsSync(imgFilepath)) {
        log(`原始图片未找到，已跳过 PhotoSwipe 处理: ${imgFilepath}`);
        continue;
      }

      try {
        // 我们只需要原始图片的尺寸，所以直接读取
        const metadata = await sharp(imgFilepath).metadata();
        if (!metadata.width || !metadata.height) continue;

        log(
          `[${originalSrc}] Adding PhotoSwipe data: ${metadata.width}x${metadata.height}`,
        );

        // 1. 创建 <a> 标签
        const anchorNode: Element = {
          type: "element",
          tagName: "a",
          properties: {
            href: originalSrc, // 指向最高质量的原始图片
            "data-pswp-width": metadata.width,
            "data-pswp-height": metadata.height,
            target: "_blank", // 为不支持 JS 的用户提供降级
            rel: "noreferrer",
          },
          // 2. 将 .lqip-wrapper 元素作为 <a> 的子节点
          children: [node],
        };

        // 3. 用新的 <a> 标签替换掉原来的 .lqip-wrapper
        updateImageNode(anchorNode);
      } catch (error) {
        log(`处理 PhotoSwipe 元数据失败: ${originalSrc}`, error);
      }
    }
  };
};
