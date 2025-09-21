import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

const contentDir = path.resolve(process.cwd(), "src/content");
const assetsDir = path.resolve(process.cwd(), "assets");
const oldImgDir = path.resolve(process.cwd(), "img");

async function getAllMarkdownFiles() {
  const articlesDir = path.join(contentDir, "articles");
  const eventsDir = path.join(contentDir, "events");

  const articleFiles = await fs.readdir(articlesDir);
  const eventFiles = await fs.readdir(eventsDir);

  return [
    ...articleFiles.map((file) => path.join(articlesDir, file)),
    ...eventFiles.map((file) => path.join(eventsDir, file)),
  ];
}

async function processMarkdownFile(filePath: string) {
  console.log(`Processing ${filePath}...`);

  const fileContent = await fs.readFile(filePath, "utf-8");
  const fileInfo = path.parse(filePath);
  const fileType = path.basename(path.dirname(filePath)).slice(0, -1); // 'article' or 'event'

  // 1. Create a new directory for the assets.
  const assetDirName = `${fileType}-${fileInfo.name.split(".")[0]}`;
  const assetDir = path.join(assetsDir, assetDirName);
  await fs.mkdir(assetDir, { recursive: true });

  // 2. Find all image paths in the markdown content.
  // The regex should find markdown image syntax: ![alt text](path)
  const imgRegex = /!\[.*?\]\((.*?)\)/g;
  let newContent = fileContent;
  let match;

  while ((match = imgRegex.exec(fileContent)) !== null) {
    const originalImgPath = match[1];

    // 3. Resolve the source image path.
    // The paths in the markdown are root-relative (e.g., /img/foo/bar.png).
    const relativeImgPath = originalImgPath.startsWith("/")
      ? originalImgPath.substring(1)
      : originalImgPath;
    const sourceImgPath = path.resolve(process.cwd(), relativeImgPath);

    // Check if the image exists in the old img directory
    if (existsSync(sourceImgPath) && sourceImgPath.startsWith(oldImgDir)) {
      const imgFileName = path.basename(sourceImgPath);
      const destImgPath = path.join(assetDir, imgFileName);

      try {
        // 4. Move the image.
        await fs.rename(sourceImgPath, destImgPath);
        console.log(`Moved ${sourceImgPath} to ${destImgPath}`);

        // 5. Update the markdown content with the new relative path.
        const newRelativePath = path.relative(
          path.dirname(filePath),
          destImgPath,
        );
        newContent = newContent.replace(
          originalImgPath,
          newRelativePath.replace(/\\/g, "/"),
        );
      } catch (error: any) {
        if (error.code === "ENOENT") {
          console.warn(`Image not found, skipping: ${sourceImgPath}`);
        } else {
          console.error(`Error moving image ${sourceImgPath}:`, error);
        }
      }
    }
  }

  // 6. Write the updated content back to the file.
  await fs.writeFile(filePath, newContent, "utf-8");
  console.log(`Finished processing ${filePath}.`);
}

async function main() {
  try {
    const markdownFiles = await getAllMarkdownFiles();
    for (const file of markdownFiles) {
      await processMarkdownFile(file);
    }
    console.log("Asset reorganization complete!");
  } catch (error) {
    console.error("An error occurred during asset reorganization:", error);
  }
}

main();
