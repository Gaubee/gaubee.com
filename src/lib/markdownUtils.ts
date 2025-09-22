export function extractImagesFromMarkdown(markdown: string): string[] {
  const imageRegex = /!\[.*?\]\((.*?)\)/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    images.push(match[1]);
  }
  return images;
}

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

export function getMdTitle(title?: string, body?: string) {
  return (
    title || (body ?? "").split("\n").find((line) => /^#+\s+.+/.test(line))
  );
}
