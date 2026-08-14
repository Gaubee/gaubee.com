import { notifySuccess, notifyError } from "$lib/apps/builtin/notifications/service.svelte";

import { fileClipboard } from "./clipboard.svelte";
/**
 * GithubEditor 文件操作逻辑（runes hooks）。
 *
 * 2026-08-02：从 EditorWorkspace 抽出文件树操作（重命名/删除/复制/剪切/粘贴/拖拽移动），
 * 保持组件文件聚焦 UI 渲染。所有操作基于 EditorVfs，纯逻辑可测。
 *
 * 数据流：
 * - 复制/剪切 → fileClipboard.set(path, mode)
 * - 粘贴 → 读 fileClipboard → vfs.renameLocal（cut）或 复制（copy）
 * - 拖拽移动 → onDropOnDir → vfs.renameLocal(source, targetPath)
 * - 重命名 → vfs.renameLocal(old, new)
 * - 删除 → vfs.deleteLocal
 */
import type { EditorVfs } from "./editor-vfs.svelte";

/** 创建文件操作处理器。绑定到一个 EditorVfs 实例。 */
export function createFileOps(vfs: EditorVfs) {
  /**
   * 重命名文件/目录。
   * vfs.renameLocal 已处理冲突检测（新路径存在返回 null）。
   */
  async function rename(oldPath: string, newPath: string): Promise<boolean> {
    const result = await vfs.renameLocal(oldPath, newPath);
    if (result === null) {
      notifyError("重命名失败", "目标路径已存在");
      return false;
    }
    notifySuccess("已重命名", `${oldPath} → ${newPath}`);
    return true;
  }

  /** 删除文件/目录（软删除，标 dirty）。 */
  async function remove(path: string): Promise<void> {
    await vfs.deleteLocal(path);
    notifySuccess("已删除", `${path}（切到「变更」tab 提交生效）`);
  }

  /** 复制到剪贴板。 */
  function copy(path: string): void {
    fileClipboard.set(path, "copy");
    notifySuccess("已复制", path);
  }

  /** 剪切到剪贴板。 */
  function cut(path: string): void {
    fileClipboard.set(path, "cut");
    notifySuccess("已剪切", path);
  }

  /**
   * 粘贴到目标目录。
   * - cut 模式：renameLocal（移动）
   * - copy 模式：读源内容 → writeLocal 到新路径（复制）
   * @returns 新路径（成功）或 null（冲突/剪贴板空）
   */
  async function paste(targetDir: string): Promise<string | null> {
    const entry = fileClipboard.entry;
    if (!entry) return null;
    const sourceName = entry.path.split("/").pop() ?? entry.path;
    const targetPath = targetDir ? `${targetDir}/${sourceName}` : sourceName;
    if (targetPath === entry.path) {
      // 粘贴到自己 = 无操作
      if (entry.mode === "cut") fileClipboard.clear();
      return targetPath;
    }
    if (await vfs.exists(targetPath)) {
      notifyError("粘贴失败", `${targetPath} 已存在`);
      return null;
    }
    if (entry.mode === "cut") {
      const result = await vfs.renameLocal(entry.path, targetPath);
      if (result === null) {
        notifyError("移动失败", "目标路径已存在");
        return null;
      }
      fileClipboard.clear();
      notifySuccess("已移动", `${entry.path} → ${targetPath}`);
    } else {
      // copy：读源内容写新路径
      const content = await vfs.readFile(entry.path);
      await vfs.writeLocal(targetPath, content);
      notifySuccess("已复制", `${entry.path} → ${targetPath}`);
    }
    return targetPath;
  }

  /**
   * 拖拽移动：把 source 移到 targetDir 下。
   * @returns 新路径（成功）或 null（冲突/同目录）
   */
  async function moveByDrop(source: string, targetDir: string): Promise<string | null> {
    const sourceName = source.split("/").pop() ?? source;
    const sourceDir = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
    // 同目录移动 = 无操作
    if (sourceDir === targetDir) return null;
    const targetPath = targetDir ? `${targetDir}/${sourceName}` : sourceName;
    if (await vfs.exists(targetPath)) {
      notifyError("移动失败", `${targetPath} 已存在`);
      return null;
    }
    const result = await vfs.renameLocal(source, targetPath);
    if (result === null) {
      notifyError("移动失败", "目标路径已存在");
      return null;
    }
    notifySuccess("已移动", `${source} → ${targetPath}`);
    return targetPath;
  }

  return { rename, remove, copy, cut, paste, moveByDrop };
}
