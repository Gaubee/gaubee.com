// import { fromAsyncCodeToHtml } from "@shikijs/markdown-it/async";
// import { codeToHtml } from "shiki"; // Or your custom shorthand bundle
// export const markdownItHightlight = fromAsyncCodeToHtml(
//   // Pass the codeToHtml function
//   codeToHtml,
//   {
//     themes: {
//       light: "github-light",
//       dark: "github-dark",
//     },
//   }
// );

import { codeToHtml } from "shiki";
import type { Plugins } from "../markdown.helper.ts";
import { visitAsync } from "./visit-async.ts";
import rehypeParse from "rehype-parse";
import remarkParse from "remark-parse";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import { arr_is_no_empty } from "@gaubee/util";

export const markdownHightlightPlugins: Plugins = {
  rehypePlugins: [
    () => {
      const rehypeParser = unified().use(rehypeParse);
      return async (tree, file) => {
        if (file.history[0]?.startsWith("0051")) {
          await visitAsync(
            tree,
            (node) => {
              if (
                node.type === "element" &&
                node.tagName === "pre" &&
                node.children.length === 1
              ) {
                return node;
              }
            },
            async (pre) => {
              const code = pre.children[0];
              if (!(code.type === "element" && code.tagName === "code")) {
                return;
              }
              const languageClassName =
                arr_is_no_empty(code.properties.className) &&
                code.properties.className.find(
                  (v) => typeof v === "string" && v.startsWith("language-")
                );
              if (typeof languageClassName !== "string") {
                return;
              }
              const language = languageClassName.replace("language-", "");
              const codeContent = code.children
                .filter((child) => child.type === "text")
                .map((child) => child.value)
                .join("");
              const htmlContent = await codeToHtml(codeContent, {
                lang: language,
                themes: {
                  light: "github-light",
                  dark: "github-dark",
                },
              });
              const hast = rehypeParser.parse(htmlContent);
              return hast;
            }
          );
        }
      };
    },
  ],
};
