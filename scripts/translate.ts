import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

const contentDir = path.resolve(process.cwd(), 'src/content');
const assetsDir = path.resolve(process.cwd(), 'assets');
const i18nDir = path.resolve(process.cwd(), 'i18n/en');

async function getAllMarkdownFiles() {
  const articlesDir = path.join(contentDir, 'articles');
  const eventsDir = path.join(contentDir, 'events');

  const articleFiles = await fs.readdir(articlesDir);
  const eventFiles = await fs.readdir(eventsDir);

  return [
    ...articleFiles.map(file => ({ type: 'article', path: path.join(articlesDir, file) })),
    ...eventFiles.map(file => ({ type: 'event', path: path.join(eventsDir, file) })),
  ];
}

function sha256(str: string) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function processMarkdownFile(file: { type: 'article' | 'event', path: string }) {
  console.log(`Processing ${file.path}...`);

  const fileContent = await fs.readFile(file.path, 'utf-8');
  const fileInfo = path.parse(file.path);

  // 1. Find associated assets.
  const assetDirName = `${file.type}-${fileInfo.name.split('.')[0]}`;
  const assetDir = path.join(assetsDir, assetDirName);
  const i18nAssetDir = path.join(i18nDir, 'assets', assetDirName);

  let assetFiles: string[] = [];
  if (existsSync(assetDir)) {
    assetFiles = await fs.readdir(assetDir);
  }

  let i18nAssetFiles: string[] = [];
  if (existsSync(i18nAssetDir)) {
    i18nAssetFiles = await fs.readdir(i18nAssetDir);
  }

  const sortedAssetFiles = [...assetFiles, ...i18nAssetFiles].sort().join('');

  // 2. Calculate the hash.
  const hash = sha256(fileContent + sortedAssetFiles);
  console.log(`  - Hash: ${hash}`);

  // 3. Check for existing translation.
  const targetDir = path.join(i18nDir, `${file.type}s`);
  const existingFiles = await fs.readdir(targetDir);
  const expectedFilename = `${fileInfo.name}.${hash}.md`;
  const translationExists = existingFiles.some(f => f === expectedFilename);

  if (translationExists) {
    console.log(`  - Translation already exists. Skipping.`);
    return;
  }

  // 4. If no translation exists, translate.
  console.log(`  - Needs translation.`);

  // Check for API key before calling the translation service
  if (!process.env.GOOGLE_API_KEY) {
    console.log('  - GOOGLE_API_KEY not set, skipping actual translation.');
    return;
  }
  // (To be implemented)
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const { totalTokens } = await model.countTokens(fileContent);
  console.log(`  - Token count: ${totalTokens}`);

  // Translate content
  const contentPrompt = `Translate the following markdown content to English. Keep the original markdown formatting. Frontmatter should also be translated.`;
  const contentResult = await model.generateContent(`${contentPrompt}\n\n${fileContent}`);
  const translatedContent = contentResult.response.text();

  // Generate filename if needed
  let newFilename = fileInfo.name;
  if (/^\d+$/.test(fileInfo.name.split('.')[0])) {
    const filenamePrompt = `Generate a descriptive, URL-friendly filename (kebab-case) for the following markdown content. The filename should be in English and should not include the file extension.`;
    const filenameResult = await model.generateContent(`${filenamePrompt}\n\n${translatedContent}`);
    newFilename = filenameResult.response.text().trim();
  }

  // Save the new file
  const newFilePath = path.join(targetDir, `${newFilename}.${hash}.md`);
  await fs.writeFile(newFilePath, translatedContent, 'utf-8');
  console.log(`  - Saved translated file to ${newFilePath}`);
}


async function main() {
  try {
    const markdownFiles = await getAllMarkdownFiles();
    for (const file of markdownFiles) {
      await processMarkdownFile(file);
    }
    console.log('Translation check complete!');
  } catch (error) {
    console.error('An error occurred during translation check:', error);
  }
}

main();
