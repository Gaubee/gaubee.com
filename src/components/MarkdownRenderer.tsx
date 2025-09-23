import { cn } from "@/lib/utils";
import type { MermaidConfig } from "mermaid";
import { Streamdown, type StreamdownProps } from "streamdown";

interface MarkdownRendererProps {
  markdown?: string;
  className?: string;
  streamdown?: StreamdownProps;
}

const mermaidConfig: MermaidConfig = {
  theme: "dark",
};

export default function MarkdownRenderer({
  markdown,
  className,
  streamdown,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
    >
      <Streamdown mermaidConfig={mermaidConfig} {...streamdown}>
        {markdown}
      </Streamdown>
    </div>
  );
}
