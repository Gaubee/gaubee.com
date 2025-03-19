/**
 * 参考 @markslides/markdown-it-mermaid 源代码
 */
import { arr_is_no_empty } from "@gaubee/util";
import { createMermaidRenderer } from "mermaid-isomorphic";
import { createHash } from "node:crypto";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
import { type Plugins } from "../markdown.helper.ts";
import { visitAsync } from "./visit-async.ts";

export const markdownMermaidPlugins: Plugins = {
  rehypePlugins: [
    () => {
      const isDarkMode = false;
      const mermaid = createMermaidRenderer();
      const injectStyles = new Set<string>();
      const css = String.raw;
      const mermaidChart = async (code: string) => {
        const res = (
          await mermaid([code], {
            css: "http://localhost:3000/renderer/css/index.css",
            mermaidConfig: {
              theme: isDarkMode ? "default" : "dark",
              darkMode: isDarkMode,
              fontFamily: "var(--font-sans-serif)",
              // fontFamily: 'ui-monospace',
              // altFontFamily: 'monospace',
              startOnLoad: true,
              fontSize: 12,
            },
            prefix: createHash("md5").update(code).digest("hex").slice(0, 6),
          })
        )[0];
        if (res.status === "rejected") {
          const err = res.reason;
          console.error(
            "mermaind parse error:",
            err instanceof Error ? err.message : err
          );
          return `<pre>${err instanceof Error ? err.message : err}</pre>`;
        }

        console.log("mermaind parse success:", code, res);

        const style = res.value.svg.match(/<style>.+<\/style>/);
        if (style) {
          injectStyles.add(style[0]);
        }
        return res.value.svg.replace(/<style>.+<\/style>/, "");
      };
      return async (tree: import("hast").Nodes) => {
        const rehypeParser = unified().use(rehypeParse);
        await visitAsync(
          tree,
          (node) => {
            if (node.type === "element" && node.tagName === "pre") {
              return node;
            }
          },
          async (pre) => {
            const code = pre.children[0];
            if (!(code.type === "element" && code.tagName === "code")) {
              return;
            }
            const isMermaidCode =
              arr_is_no_empty(code.properties.className) &&
              code.properties.className.some((v) => v === "language-mermaid");
            if (!isMermaidCode) {
              return;
            }
            const codeContent = code.children
              .filter((child) => child.type === "text")
              .map((child) => child.value)
              .join("");
            const htmlContent = await mermaidChart(codeContent);
            if (htmlContent) {
              const hast = rehypeParser.parse(htmlContent);
              return hast;
            }
          }
        );
        if (injectStyles.size) {
          injectStyles.forEach((style) => {
            (tree as import("hast").Root).children.push(
              ...rehypeParser.parse(style).children
            );
          });
        }
      };
    },
  ],
};
