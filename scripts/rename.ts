import path from "node:path";
import { getAllArticles } from "../database/articles.controller.ts";
import { writeMarkdown } from "@gaubee/nodekit";

const allArticles = await getAllArticles();
const totalLenCharsCount = 4; // allArticles.length.toString().length;
allArticles.map((article, index) => {
  const prefix = (allArticles.length - index)
    .toString()
    .padStart(totalLenCharsCount, "0");
  let filename = article.fileEntry.name.replace(/^\d+./, "");
  const newFilename = `${prefix}.${filename}`;
  const newFilepath = path.join(article.fileEntry.dir, newFilename);
  //   console.log(article.fileEntry.path, "=>", newFilepath);
  writeMarkdown(newFilepath, article.markdownContent, {
    ...article.originMetadata,
    title: article.metadata.title,
    date: article.metadata.createdAt,
    updated: article.metadata.updatedAt,
  });
  if (newFilename !== article.fileEntry.name) {
    article.fileEntry.remove();
  }
});
