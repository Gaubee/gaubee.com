import { Streamdown } from "streamdown";
import type { MermaidConfig } from "mermaid";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  markdown?: string;
  className?: string;
}

const mermaidConfig: MermaidConfig = {
  theme: "dark",
};

export default function MarkdownRenderer({
  markdown,
  className,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
    >
      <Streamdown mermaidConfig={mermaidConfig}>{markdown}</Streamdown>
    </div>
  );
}
