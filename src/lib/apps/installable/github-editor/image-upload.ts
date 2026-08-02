import { uploadIssueImage } from "../github/issue-api";
/**
 * GithubEditor 图片上传：两种方案统一封装。
 *
 * 2026-08-02：为 GithubEditor 工作区提供图片上传能力。
 *
 * 两套方案：
 * - 方案 A（资产）：经 Worker /upload/image 调 GitHub Contents API PUT，返回 raw URL。
 *   单文件即时提交（独立 commit），不进 VFS local 层，适合插图链接场景。
 * - 方案 B（VFS）：图片以 base64 写入 EditorVfs local 层（标 dirty），随文本改动
 *   合并成同一个 commit。适合把图片作为仓库代码文件版本化管理的场景。
 *
 * 选型心智：
 * - 拖到 code-editor 区域 → 资产方案（即时拿 URL 插入 markdown）
 * - 拖到 fileTree 区域 → VFS 方案（进 local 层，随 commit 提交）
 */
import type { EditorVfs } from "./editor-vfs.svelte";

/** File → 纯 base64 字符串（无 data: 前缀）。用于 VFS 二进制存储。 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`读取 ${file.name} 失败：非字符串结果`));
        return;
      }
      // readAsDataURL 产出 "data:image/png;base64,XXXX"，剥离前缀只留 base64
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

/**
 * 生成图片文件名：{timestamp}-{rand}.{ext}。
 * ext 从原始文件名取（必须有真正的扩展名，即文件名含点且点后非空），
 * 无扩展名默认 png。
 */
export function generateImageFilename(file: File): string {
  const dotIdx = file.name.lastIndexOf(".");
  // 点必须在文件名内部（不是首字符/末字符），且点后非空
  const ext = dotIdx > 0 && dotIdx < file.name.length - 1 ? file.name.slice(dotIdx + 1) : "png";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

/** 规范化目录路径（去首尾斜杠）。空串表示仓库根。 */
function normalizeDir(dir: string): string {
  return dir.replace(/^\/+|\/+$/g, "");
}

/** 拼接仓库内完整路径：dir + filename。 */
export function joinPath(dir: string, filename: string): string {
  const d = normalizeDir(dir);
  return d ? `${d}/${filename}` : filename;
}

/**
 * 方案 A：上传图片为资产（经 Worker，单文件即时 commit）。
 * @returns raw URL（可直接用于 markdown ![](url)）
 */
export async function uploadImageAsAsset(
  file: File,
  opts: { owner: string; repo: string; branch?: string; dirPath?: string },
): Promise<string> {
  return uploadIssueImage(opts.owner, opts.repo, file, {
    path: opts.dirPath,
    branch: opts.branch,
  });
}

/**
 * 方案 B：上传图片到 VFS local 层（base64，随下次 commit 提交）。
 * @returns 仓库内路径 + raw URL 预览（基于当前分支构造）
 */
export async function uploadImageToVfs(
  file: File,
  opts: { vfs: EditorVfs; dirPath: string; owner: string; repo: string; branch: string },
): Promise<{ path: string; rawUrl: string }> {
  const { vfs, dirPath, owner, repo, branch } = opts;
  const filename = generateImageFilename(file);
  const fullPath = joinPath(dirPath, filename);
  const base64 = await fileToBase64(file);
  await vfs.writeLocal(fullPath, base64, { encoding: "base64" });
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${fullPath}`;
  return { path: fullPath, rawUrl };
}

/**
 * 从 DragEvent 或 ClipboardEvent 提取 File 列表。
 * 用属性检测（'clipboardData' in e）替代 instanceof，避免 Node 等无 ClipboardEvent
 * 全局类的环境抛 ReferenceError，同时保持浏览器行为一致。
 */
function getEventFiles(e: DragEvent | ClipboardEvent): FileList | null {
  if ("clipboardData" in e) {
    const cd = (e as ClipboardEvent).clipboardData;
    return cd?.files ?? null;
  }
  return (e as DragEvent).dataTransfer?.files ?? null;
}

/** 判断拖拽/粘贴事件中是否含图片文件。 */
export function hasImageFiles(e: DragEvent | ClipboardEvent): boolean {
  const files = getEventFiles(e);
  if (!files) return false;
  for (const f of Array.from(files)) {
    if (f.type.startsWith("image/")) return true;
  }
  return false;
}

/** 从事件提取首个图片文件（粘贴/拖拽插图用）。 */
export function pickFirstImage(e: DragEvent | ClipboardEvent): File | null {
  const files = getEventFiles(e);
  if (!files) return null;
  for (const f of Array.from(files)) {
    if (f.type.startsWith("image/")) return f;
  }
  return null;
}

/** 构造 markdown 图片语法。desc 为空时用 'image'。 */
export function buildImageMarkdown(url: string, desc: string): string {
  return `![${desc || "image"}](${url})`;
}
