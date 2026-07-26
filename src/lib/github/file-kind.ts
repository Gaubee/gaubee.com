/**
 * GitHub 仓库文件类型判断（用于 fileContent 面板的渲染分支决策）。
 */

export type FileKind = "markdown" | "image" | "video" | "audio" | "text";

const EXT_MAP: Record<string, FileKind> = {
  // Markdown
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  // 图片
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  // 视频
  mp4: "video",
  webm: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  // 音频
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
};

/** 根据文件路径扩展名判断类型。未知扩展名归为 text（代码/纯文本，统一 <pre> 展示）。 */
export function getFileKind(path: string): FileKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "text";
}

/** 是否支持 Preview 模式（markdown 渲染 / 媒体播放）。text 类只有 Raw。 */
export function canPreview(kind: FileKind): boolean {
  return kind !== "text";
}
