import type { AstroIntegration } from "astro";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rehypePhotoSwipe } from "./rehype-photoswipe-plugin";

// --- Astro 集成定义 ---
export function astroPhotoSwipe(): AstroIntegration {
  return {
    name: "astro-photoswipe",
    hooks: {
      "astro:config:setup": ({ updateConfig, injectScript }) => {
        // 1. 注入 Rehype 插件
        // 注意：这个插件应该在您的插件链的最后运行
        updateConfig({
          markdown: {
            rehypePlugins: [rehypePhotoSwipe],
          },
        });

        // 2. 注入客户端加载器脚本
        const scriptPath = path.resolve(
          fileURLToPath(import.meta.url),
          "../photoswipe-loader.ts",
        );
        injectScript("page", `import "${scriptPath}";`);
      },
    },
  };
}
