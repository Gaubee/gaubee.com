import { cn } from "@/lib/utils";
import type { MermaidConfig } from "mermaid";
import { Streamdown } from "streamdown";

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
