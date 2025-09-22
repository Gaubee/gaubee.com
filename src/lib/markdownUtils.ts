export interface MarkdownPreview {
  previewText: string;
  images: string[];
  isTruncated: boolean;
}

export function generateMarkdownPreview(markdown: string): MarkdownPreview {
  // 1. Extract all image URLs from the markdown content.
  const imageRegex = /!\[.*?\]\((.*?)\)/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    images.push(match[1]);
  }

  // 2. Remove image tags from the markdown content.
  const textOnlyMarkdown = markdown.replace(imageRegex, "").trim();

  // 3. Split content into lines and filter out empty lines.
  const lines = textOnlyMarkdown.split('\n').filter(line => line.trim() !== '');

  // 4. Truncate to 3-8 lines.
  const maxLines = 8;
  const isTruncated = lines.length > maxLines;
  const truncatedLines = lines.slice(0, maxLines);

  // 5. Join the lines back together.
  const previewText = truncatedLines.join('\n');

  return {
    previewText,
    images,
    isTruncated,
  };
}
