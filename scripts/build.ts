import { marked } from 'marked';
import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SRC_DIR = 'src/content';
const DIST_DIR = 'dist';

interface ContentItem {
  title: string;
  date: string;
  path: string;
  type: 'article' | 'event';
}

/**
 * Processes a directory of markdown files, converting them to HTML and extracting metadata.
 */
async function processDirectory(contentDir: 'articles' | 'events'): Promise<ContentItem[]> {
  const sourcePath = path.join(SRC_DIR, contentDir);
  const destPath = path.join(DIST_DIR, contentDir);
  const contentItems: ContentItem[] = [];

  try {
    await fs.mkdir(destPath, { recursive: true });
    const files = await fs.readdir(sourcePath);

    for (const file of files) {
      if (path.extname(file) !== '.md') continue;

      const articlePath = path.join(sourcePath, file);
      const fileContent = await fs.readFile(articlePath, 'utf-8');
      const { data, content } = matter(fileContent);

      const title = data.title || path.basename(file, '.md');
      const date = data.date || new Date().toISOString();

      const htmlContent = await marked.parse(content);
      const outputFilename = path.basename(file, '.md') + '.html';
      const outputPath = path.join(destPath, outputFilename);

      // Still generate individual HTML pages
      const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <main>
    ${htmlContent}
  </main>
</body>
</html>
      `.trim();
      await fs.writeFile(outputPath, htmlTemplate);

      contentItems.push({
        title,
        date,
        path: `/${contentDir}/${outputFilename}`,
        type: contentDir,
      });
    }
    console.log(`Successfully processed directory: ${contentDir}`);
    return contentItems;
  } catch (error) {
    console.error(`Error processing directory ${contentDir}:`, error);
    throw error;
  }
}

async function build() {
  console.log('Starting content generation script...');
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  console.log('Cleaned dist directory.');

  const articles = await processDirectory('articles');
  const events = await processDirectory('events');

  const allContent = [...articles, ...events];

  const sortedItems = allContent.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Ensure dist directory exists for the JSON file
  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.writeFile(path.join(DIST_DIR, 'content.json'), JSON.stringify(sortedItems, null, 2));
  console.log('Successfully generated content.json');

  console.log('Content generation script finished successfully.');
}

build().catch(error => {
  console.error('Content generation failed:', error);
  process.exit(1);
});
