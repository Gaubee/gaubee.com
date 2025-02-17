import { fromAsyncCodeToHtml } from "@shikijs/markdown-it/async";
import MarkdownItAsync from "markdown-it-async";
import { codeToHtml } from "shiki"; // Or your custom shorthand bundle

// Initialize MarkdownIt instance with markdown-it-async
export const md = MarkdownItAsync({ html: true });
md.use(
  fromAsyncCodeToHtml(
    // Pass the codeToHtml function
    codeToHtml,
    {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    }
  )
);
