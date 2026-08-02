/**
 * GithubEditor 文件剪贴板（runes 响应式）。
 *
 * 2026-08-02：为文件树复制/剪切/粘贴提供内存态剪贴板。
 * - copy：记录 source path + mode='copy'
 * - cut：记录 source path + mode='cut'（粘贴后源头删除）
 * - paste：读取剪贴板，调用方执行实际的复制/移动（需查冲突）
 *
 * 设计为模块级单例（同一时刻只有一份剪贴板内容）。
 */

export type ClipboardMode = "copy" | "cut";

export interface FileClipboardEntry {
  /** 源文件完整路径。 */
  path: string;
  mode: ClipboardMode;
}

/** 当前剪贴板内容（null=空）。 */
let entry = $state<FileClipboardEntry | null>(null);

/** 读当前剪贴板内容（响应式）。 */
export const fileClipboard = {
  get entry() {
    return entry;
  },
  /** 是否有内容。 */
  get has() {
    return entry !== null;
  },
  /** 设置剪贴板（copy 或 cut）。 */
  set(path: string, mode: ClipboardMode) {
    entry = { path, mode };
  },
  /** 清空剪贴板。 */
  clear() {
    entry = null;
  },
};
