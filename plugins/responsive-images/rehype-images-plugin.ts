import type { RehypePlugins } from "astro";
import Debug from "debug";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PUBLIC_NAME, rootResolver } from "../helper/dirs";
import { getFileHash } from "../helper/filehash";
import { getLocalImgs } from "../helper/get-local-imgs";

const log = Debug("rehype-responsive-images");
// --- 配置 ---
// 定义要生成哪些宽度的图片
const WIDTHS = [480, 800, 1200, 1600];
// 定义 sizes 属性，告诉浏览器图片在不同视口下的显示宽度
const SIZES = "(max-width: 768px) 100vw, (max-width: 1600px) 80vw, 1200px";
// 将生成的图片写入 public/_gen 目录，Astro会自动将其复制到 dist
const GENERATED_ASSETS_DIR_NAME = "_gen";
const GENERATED_ASSETS_PUBLIC_DIR = rootResolver(
  PUBLIC_NAME,
  GENERATED_ASSETS_DIR_NAME,
);
// 缓存目录
const CACHE_DIR = rootResolver(
  "node_modules/.astro/cache/rehype-responsive-images",
);
// --- 配置结束 ---

/**
 * 检查并创建目录
 */
async function ensureDirExists(dirPath: string) {
  if (!existsSync(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * 定义我们内部使用的数据结构
 */
interface ImageSource {
  src: string;
  width: number;
}

/**
 * Astro Rehype 插件，用于处理 Markdown 中的图片
 */
export const rehypeResponsiveImages: RehypePlugins[number] = () => {
  return async (tree, file) => {
    // 1. 收集所有需要处理的图片节点
    const imageNodes = getLocalImgs(tree);

    if (imageNodes.length === 0) {
      return;
    }
    log(
      "rehypeResponsiveImages:",
      file.path,
      imageNodes.map((node) => node.imgSrc),
    );

    // 2. 并行处理所有收集到的图片
    for (const { imgSrc, imgFilepath, node, updateImageNode } of imageNodes) {
      try {
        const imageHash = await getFileHash(imgFilepath);
        const imageCacheDir = path.join(CACHE_DIR, imageHash);
        const imagePublicDir = path.join(
          GENERATED_ASSETS_PUBLIC_DIR,
          imageHash,
        );
        await ensureDirExists(imagePublicDir); // 确保本次构建的输出目录存在

        const image = sharp(imgFilepath);
        const metadata = await image.metadata();
        log(imgFilepath, metadata.width);

        if (!metadata.width) {
          throw new Error("无法读取图片宽度");
        }

        const { name } = path.parse(imgSrc);

        // 创建一个数组来存储所有图片源
        const sourceEntries: ImageSource[] = [];

        // =================================================================
        // 以下是重写的核心逻辑
        // =================================================================

        const webpGenerationTasks = WIDTHS
          // 过滤掉比原图还大的尺寸
          .filter((width) => width < metadata.width!) // 使用'<'确保我们只生成更小的版本，原始版本已包含
          .map(async (width): Promise<ImageSource | null> => {
            try {
              const newFileName = `${name}-${width}w.webp`;
              const cachedFilePath = path.join(imageCacheDir, newFileName);
              const publicFilePath = path.join(imagePublicDir, newFileName);

              // 核心逻辑：检查缓存，如果不存在则生成
              if (!existsSync(cachedFilePath)) {
                await ensureDirExists(imageCacheDir);
                await image
                  .clone()
                  .resize(width)
                  .toFormat("webp")
                  .toFile(cachedFilePath);
                log(`已生成缓存: ${cachedFilePath}`);
              } else {
                log(`命中缓存: ${cachedFilePath}`);
              }

              // 将缓存文件复制到 public/_gen 目录，以便 Astro 处理
              if (!existsSync(publicFilePath)) {
                await fs.copyFile(cachedFilePath, publicFilePath);
              }

              // 返回最终在网站上可访问的 URL
              const publicUrl = `/${GENERATED_ASSETS_DIR_NAME}/${imageHash}/${newFileName}`;
              return { src: publicUrl, width: width };
            } catch (err) {
              log(`生成 ${width}w WebP 图片失败: ${imgSrc}`, err);
              return null; // 如果某个尺寸生成失败，返回null
            }
          });

        const generatedWebpSources = (
          await Promise.all(webpGenerationTasks)
        ).filter((p): p is ImageSource => p !== null); // 过滤掉失败的条目

        sourceEntries.push(...generatedWebpSources);

        if (sourceEntries.length > 0) {
          // 将原始图片作为一个源添加进来;
          sourceEntries.push({
            src: imgSrc,
            width: metadata.width,
          });
          // 按宽度从小到大排序所有源
          sourceEntries.sort((a, b) => a.width - b.width);

          log("生成 sources", sourceEntries);

          // 3. 修改 AST 中的 img 节点属性
          const srcset = sourceEntries
            .map((entry) => `${entry.src} ${entry.width}w`)
            .join(", ");

          node.properties.srcset = srcset;
          node.properties.sizes = SIZES; // sizes 描述布局，保持不变是正确的
          node.properties.loading = "lazy";
          node.properties.decoding = "async";

          // 添加 width 和 height 属性可以防止布局抖动 (CLS)
          // 计算一个基于最小尺寸图片的宽高比
          if (metadata.height) {
            node.properties.width = sourceEntries[0].width;
            node.properties.height = Math.round(
              (sourceEntries[0].width / metadata.width) * metadata.height,
            );
          }

          updateImageNode();
        }
        // =================================================================
        // 重写逻辑结束
        // =================================================================
      } catch (error) {
        log(`处理图片失败: ${imgSrc}`, error);
      }
    }
  };
};
