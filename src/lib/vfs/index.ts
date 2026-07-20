/**
 * VFS 统一入口：只读层 + 可写层的合并。
 *
 * 读取优先级：
 * 1. 可写层（IndexedDB）—— 本地修改优先
 * 2. 只读层（构建时生成的静态数据）—— 无需登录即可读取
 * 3. 在线拉取（GitHub API）—— 可写层的 fallback
 *
 * 写入操作：仅作用于可写层（IndexedDB）。
 */

import { vfs, type VfsNode } from "./vfs";
import { readonlyVfs, type ReadonlyNode } from "./readonly";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 统一文件节点（只读 + 可写）。 */
export interface UnifiedNode {
  path: string;
  content: string | null;
  /** 来源：readonly=构建时静态数据，writable=本地修改，remote=在线拉取。 */
  origin: "readonly" | "writable" | "remote";
  /** 是否可写（readonly 的文件不可直接修改，需先复制到可写层）。 */
  readonly: boolean;
  /** 有未提交修改（仅 writable 层有效）。 */
  dirty?: boolean;
  /** 远程 blob sha（仅 remote/writable 层有效）。 */
  sha?: string | null;
  /** 修改时间戳（仅 writable 层有效）。 */
  mtime?: number;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function toUnifiedNode(
  node: VfsNode | ReadonlyNode,
  origin: "readonly" | "writable" | "remote",
): UnifiedNode {
  if ("origin" in node) {
    // VfsNode
    return {
      path: node.path,
      content: node.content,
      origin,
      readonly: origin === "readonly",
      dirty: node.dirty,
      sha: node.sha,
      mtime: node.mtime,
    };
  }
  // ReadonlyNode
  return {
    path: node.path,
    content: node.content,
    origin,
    readonly: true,
  };
}

/** 规范化路径：去除前导/后置斜杠，合并重复斜杠。 */
function normalizePath(p: string): string {
  return p.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

// ---------------------------------------------------------------------------
// 统一 VFS 类
// ---------------------------------------------------------------------------

export class UnifiedVfs {
  private readonly writable = vfs;
  private readonly readonly = readonlyVfs;

  // ---- 读取操作 ----

  /**
   * 读取文件文本内容。
   * 优先级：可写层 > 只读层 > 在线拉取。
   */
  async readFile(path: string): Promise<string> {
    const p = normalizePath(path);
    
    // 1. 先查可写层（本地修改优先）
    try {
      const writableContent = await this.writable.readFile(p);
      if (writableContent) return writableContent;
    } catch {
      // 可写层无此文件，继续
    }
    
    // 2. 再查只读层（构建时静态数据）
    const readonlyContent = this.readonly.readFile(p);
    if (readonlyContent !== null) return readonlyContent;
    
    // 3. 最后在线拉取（GitHub API）
    return this.writable.readFile(p);
  }

  /** 列出某前缀下的所有文件（合并只读层 + 可写层）。 */
  async readdir(prefix = "", opts: { recursive?: boolean } = {}): Promise<UnifiedNode[]> {
    const p = normalizePath(prefix);
    
    // 并行读取两层
    const [writableNodes, readonlyNodes] = await Promise.all([
      this.writable.readdir(p, opts),
      Promise.resolve().then(() => this.readonly.readdir(p, opts)),
    ]);
    
    // 建立 path -> node 的映射（可写层优先）
    const map = new Map<string, UnifiedNode>();
    
    // 先放只读层
    for (const node of readonlyNodes) {
      map.set(node.path, toUnifiedNode(node, "readonly"));
    }
    
    // 再用可写层覆盖（本地修改优先）
    for (const node of writableNodes) {
      map.set(node.path, toUnifiedNode(node, node.origin === "local" ? "writable" : "remote"));
    }
    
    return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  /** 获取文件元数据（不触发拉取）。 */
  async stat(path: string): Promise<UnifiedNode | null> {
    const p = normalizePath(path);
    
    // 先查可写层
    const writableNode = await this.writable.stat(p);
    if (writableNode) {
      return toUnifiedNode(writableNode, writableNode.origin === "local" ? "writable" : "remote");
    }
    
    // 再查只读层
    const readonlyNode = this.readonly.stat(p);
    if (readonlyNode) {
      return toUnifiedNode(readonlyNode, "readonly");
    }
    
    return null;
  }

  // ---- 写入操作（仅可写层） ----

  /** 写入文件（自动标记 dirty）。 */
  async writeFile(path: string, content: string): Promise<void> {
    return this.writable.writeFile(path, content);
  }

  /** 删除文件（标记为待删除）。 */
  async unlink(path: string): Promise<void> {
    return this.writable.unlink(path);
  }

  /** 撤销本地修改。 */
  async revert(path: string): Promise<void> {
    return this.writable.revert(path);
  }

  // ---- 只读层快捷访问 ----

  /** 从只读层直接读取 posts（无需登录，零延迟）。 */
  getReadonlyPosts() {
    return this.readonly.getPosts();
  }

  /** 从只读层按 collection 筛选 posts。 */
  getReadonlyPostsByCollection(collection: "articles" | "events") {
    return this.readonly.getPostsByCollection(collection);
  }

  /** 从只读层查找单篇 post。 */
  findReadonlyPost(collection: "articles" | "events", stem: string) {
    return this.readonly.findPost(collection, stem);
  }

  // ---- 可写层快捷访问 ----

  /** 列出所有 dirty 文件。 */
  async dirtyFiles(): Promise<VfsNode[]> {
    return this.writable.dirtyFiles();
  }

  /** 从 GitHub 同步。 */
  async fetch(subtree?: string): Promise<void> {
    return this.writable.fetch(subtree);
  }

  /** 提交到 GitHub。 */
  async commit(message: string): Promise<string> {
    return this.writable.commit(message);
  }
}

/** 单例。 */
export const unifiedVfs = new UnifiedVfs();

// 导出类型和子模块
export type { VfsNode } from "./vfs";
export type { ReadonlyNode, ReadonlyPost } from "./readonly";
