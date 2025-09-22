import { Streamdown } from "streamdown";
import type { MermaidConfig } from "mermaid";

interface MarkdownRendererProps {
  markdown: string;
}

const mermaidConfig: MermaidConfig = {
  theme: "dark",
};

export default function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <Streamdown mermaidConfig={mermaidConfig}>{markdown}</Streamdown>
    </div>
  );
}
