import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import matter from "gray-matter";
import MiniSearch from "minisearch";

// Define the structure of the documents we want to index
interface Document {
  id: string;
  title: string;
  description: string;
  tags: string[];
  content: string;
  collection: string;
}

async function generateSearchIndex() {
  console.log("Generating search index...");

  // 1. Initialize MiniSearch
  const miniSearch = new MiniSearch<Document>({
    fields: ["title", "description", "tags", "content"], // Fields to index for searching
    storeFields: ["title", "description", "collection", "id"], // Fields to store and return with search results
    idField: "id",
  });

  // 2. Find all markdown files
  const articleFiles = await glob("src/content/articles/**/*.md");
  const eventFiles = await glob("src/content/events/**/*.md");
  const allFiles = [...articleFiles, ...eventFiles];

  // 3. Process each file
  for (const filePath of allFiles) {
    try {
      const fileContent = await fs.readFile(filePath, "utf-8");
      const { data, content } = matter(fileContent);

      if (!data.title || !data.date) {
        console.warn(
          `Skipping ${filePath}: missing title or date in frontmatter.`,
        );
        continue;
      }

      // Determine slug from file path
      const collection = filePath.includes("/articles/")
        ? "articles"
        : "events";
      const id = path.basename(filePath, ".md");

      const doc: Document = {
        id: id,
        title: data.title,
        description: data.description || content.substring(0, 150), // Use description or excerpt
        tags: data.tags || [],
        content: content, // The full text content for searching
        collection: collection,
      };

      await miniSearch.add(doc);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }

  // 4. Serialize and save the index
  const jsonIndex = JSON.stringify(miniSearch.toJSON());
  const outputPath = path.join(process.cwd(), "public", "search-index.json");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, jsonIndex);

  console.log(
    `Search index generated successfully with ${miniSearch.documentCount} documents.`,
  );
  console.log(`Index saved to: ${outputPath}`);
}

generateSearchIndex().catch((error) => {
  console.error("Failed to generate search index:", error);
  process.exit(1);
});
