import { MarkdownPreview } from "@/lib/markdownUtils";
import type { CollectionEntry } from "astro:content";
import { marked } from "marked";
import { useEffect, useRef } from "react";

export default function MarkdownPreviewCard({
  content,
  preview,
}: {
  content: CollectionEntry<"articles"> | CollectionEntry<"events">;
  preview: MarkdownPreview;
}) {
  function getGridColsClass(count: number): string {
    if (count === 1) return "grid-cols-1";
    if (count <= 4) return "grid-cols-2";
    return "grid-cols-3";
  }

  const { id, collection, data } = content;
  const { title, date } = data;
  const url = `/${collection}/${id.replace(/\.mdx?$/, "")}`;
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current && preview.previewText) {
      contentRef.current.innerHTML = marked(preview.previewText) as string;
    }
  }, [preview.previewText]);

  return (
    <div className="flex flex-col gap-2 p-4 border-b border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span className="capitalize">{collection}</span>
        <span>·</span>
        <time dateTime={date.toISOString()}>
          {new Date(date).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
      </div>
      <a href={url} className="contents">
        <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
          {title}
        </h2>
      </a>

      {preview.images.length > 0 && (
        <div
          className={`grid gap-2 ${getGridColsClass(preview.images.length)}`}
        >
          {preview.images.slice(0, 9).map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`preview image ${i + 1}`}
              className="w-full h-auto object-cover rounded-md"
            />
          ))}
        </div>
      )}

      {preview.previewText && (
        <div
          ref={contentRef}
          className={`prose prose-sm dark:prose-invert max-w-none ${
            preview.isTruncated ? "mask-fade-bottom" : ""
          }`}
        ></div>
      )}
    </div>
  );
}

// Add this to a global CSS file, e.g., src/tailwind.css
// .mask-fade-bottom {
//   mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
// }
