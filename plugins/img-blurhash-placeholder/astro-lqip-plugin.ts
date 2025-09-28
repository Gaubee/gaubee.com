import type { AstroIntegration } from "astro";
import path from "path";
import { fileURLToPath } from "url";
import { rehypeLqip } from "./rehype-lqip-plugin";

// --- Astro 集成 ---

export function astroLqip(): AstroIntegration {
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
