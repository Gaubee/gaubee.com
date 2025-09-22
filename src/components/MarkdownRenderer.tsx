import { useEffect, useRef } from "react";
import streamdown from "streamdown";
import mermaid from "mermaid";

interface MarkdownRendererProps {
  markdown: string;
}

export default function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderMarkdown = async () => {
      if (!contentRef.current) return;

      // 1. Render markdown using streamdown
      const renderer = streamdown();
      let html = "";
      for await (const chunk of renderer.parse(markdown)) {
        html += chunk;
      }
      contentRef.current.innerHTML = html;

      // 2. Initialize and render Mermaid diagrams
      try {
        mermaid.initialize({ startOnLoad: false });
        await mermaid.run({
          nodes: contentRef.current.querySelectorAll("pre.mermaid"),
        });
      } catch (e) {
        console.error("Mermaid rendering failed:", e);
      }
    };

    renderMarkdown();
  }, [markdown]);

  return <div ref={contentRef} className="prose prose-sm dark:prose-invert max-w-none"></div>;
}
