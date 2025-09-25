import { glob, type Loader } from "astro/loaders";
import { defineCollection, z } from "astro:content";

export function getPreviewBody(body?: string) {
  const lines = (body ?? "").split("\n");
  let endIndex = 0;
  let matchLineCount = 0;
  for (; endIndex < lines.length; endIndex++) {
    if (lines[endIndex].trim() === "") {
      continue;
    }
    matchLineCount++;
    if (matchLineCount > 8) {
      break;
    }
  }
  return lines.slice(0, endIndex).join("\n");
}

const zMetadataSchema = z
  .object({
    title: z.string().optional(),
    date: z
      .union([z.date(), z.string().datetime()])
      .transform((v) => new Date(v)),
    updated: z
      .union([z.date(), z.string().datetime()])
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
    tags: z.array(z.string()).default([]),
    preview: z.string().optional(),
    previewHTML: z.string().optional(),
  })
  .passthrough();

function createMdLoader(contentType: string): Loader {
  const base = glob({
    pattern: "**/*.{md,mdx}",
    base: `./src/content/${contentType}`,
  });

  return {
    ...base,
    async load(context) {
      await base.load(context);

      for (const entry of context.store.values()) {
        // 安全转换，校验失败会抛详细堆栈
        const data = zMetadataSchema.parse(entry.data);

        if (!data.previewHTML) {
          data.preview ??= getPreviewBody(entry.body);
          data.previewHTML = (await context.renderMarkdown(data.preview)).html;

          // 写回 store
          entry.data = data;
          context.store.set(entry);
        }
      }
    },
  };
}

export const collections = {
  articles: defineCollection({
    loader: createMdLoader("articles"),
    schema: zMetadataSchema,
  }),
  events: defineCollection({
    loader: createMdLoader("events"),
    schema: zMetadataSchema,
  }),
};
