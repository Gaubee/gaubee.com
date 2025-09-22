import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarkdownHeading } from "astro";

interface Props {
  title?: string;
  headings: MarkdownHeading[];
}

export default function TableOfContentsCard({ title, headings }: Props) {
  if (!headings || headings.length === 0) {
    return null;
  }

  return (
    <Card>
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <ul>
          {headings.map((heading) => (
            <li key={heading.slug}>
              <a href={`#${heading.slug}`}>{heading.text}</a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
