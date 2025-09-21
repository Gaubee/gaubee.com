import { defineCollection, z } from "astro:content";

const articleCollection = defineCollection({
  type: "content",
  schema: z
    .object({
      title: z.string(),
      date: z.date(),
      updated: z.date().optional(),
      tags: z.array(z.string()).optional(),
      // Allow other fields that are not strictly typed
    })
    .passthrough(),
});

const eventCollection = defineCollection({
  type: "content",
  schema: z
    .object({
      title: z.string().optional(), // Events might not have titles
      date: z.date(),
      updated: z.date().optional(),
      tags: z.array(z.string()).optional(),
    })
    .passthrough(),
});

export const collections = {
  articles: articleCollection,
  events: eventCollection,
};
