import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";

interface MarkdownPreviewProps {
  content: string;
}

export default function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    const slugger = (text: string) => {
      return text
        .toLowerCase()
        .trim()
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
        .replace(/\s/g, '-');
    };

    const walkTokens = (token: any) => {
      if (token.type === "heading") {
        token.data = token.data || {};
        token.data.id = slugger(token.text);
      }
    };

    marked.use({ walkTokens });

    const rawHtml = marked.parse(content) as string;
    const sanitizedHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ["id"] });

    setHtml(sanitizedHtml);
  }, [content]);

  useEffect(() => {
    // After the HTML is rendered, find and render any Mermaid diagrams
    try {
      mermaid.run({
        nodes: document.querySelectorAll(".language-mermaid"),
      });
    } catch (e) {
      console.error("Mermaid rendering failed:", e);
    }
  }, [html]);

  return (
    <div
      className="prose prose-invert max-w-none rounded-lg border bg-background p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}