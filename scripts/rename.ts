import {writeMarkdown} from '@gaubee/nodekit';
import path from 'node:path';
import {getAllArticles} from '../database/articles.controller.ts';
import {getAllEvents} from '../database/events.controller.ts';

{
  const allArticles = await getAllArticles();
  const totalLenCharsCount = 4; // allArticles.length.toString().length;
  allArticles.map((article, index) => {
    const prefix = (allArticles.length - index).toString().padStart(totalLenCharsCount, '0');
    let filename = article.fileEntry.name.replace(/^\d+./, '');
    const newFilename = `${prefix}.${filename}`;
    const newFilepath = path.join(article.fileEntry.dir, newFilename);
    //   console.log(article.fileEntry.path, "=>", newFilepath);
    writeMarkdown(newFilepath, article.markdownContent, {
      ...article.originMetadata,
      layout: "article.11ty.ts",
      title: article.metadata.title,
      date: article.metadata.createdAt,
      updated: article.metadata.updatedAt,
      tags: [...new Set(['article', ...article.metadata.tags])],
    });
    if (newFilename !== article.fileEntry.name) {
      article.fileEntry.remove();
    }
  });
}

{
  const allEvents = await getAllEvents();
  const totalLenCharsCount = 5;
  allEvents.map((article, index) => {
    const prefix = (allEvents.length - index).toString().padStart(totalLenCharsCount, '0');
    let filename = article.fileEntry.name.replace(/^\d+./, '');
    const newFilename = `${prefix}.${filename}`;
    const newFilepath = path.join(article.fileEntry.dir, newFilename);
    //   console.log(article.fileEntry.path, "=>", newFilepath);
    writeMarkdown(newFilepath, article.markdownContent, {
      ...article.originMetadata,
      layout: "event.11ty.ts",
      date: article.metadata.createdAt,
      tags: [...new Set(['event', ...article.metadata.tags])],
    });
    if (newFilename !== article.fileEntry.name) {
      article.fileEntry.remove();
    }
  });
}
