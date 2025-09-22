export function extractImagesFromMarkdown(markdown: string): string[] {
  const imageRegex = /!\[.*?\]\((.*?)\)/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    images.push(match[1]);
  }
  return images;
}
