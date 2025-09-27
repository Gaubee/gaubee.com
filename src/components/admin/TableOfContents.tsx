import { useEffect, useState } from "react";

interface TableOfContentsProps {
  content: string;
}

interface Heading {
  level: number;
  text: string;
  id: string;
}

export default function TableOfContents({ content }: TableOfContentsProps) {
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    const headingRegex = /^(#{1,6})\s+(.*)/gm;
    const matches = Array.from(content.matchAll(headingRegex));
    const extractedHeadings = matches.map((match) => {
      const level = match[1].length;
      const text = match[2];
      const id = text.toLowerCase().replace(/[^\w]+/g, "-");
      return { level, text, id };
    });
    setHeadings(extractedHeadings);
  }, [content]);

  return (
    <div className="rounded-lg border bg-background p-4">
      <h2 className="mb-4 text-lg font-semibold">Table of Contents</h2>
      <ul className="space-y-2">
        {headings.map((heading) => (
          <li key={heading.id} style={{ marginLeft: `${(heading.level - 1) * 1}rem` }}>
            <a
              href={`#${heading.id}`}
              className="text-muted-foreground hover:text-foreground"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}