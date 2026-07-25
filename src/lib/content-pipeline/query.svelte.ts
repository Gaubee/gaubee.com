/**
 * 统一内容查询层（单例）。
 *
 * 替代 readonlyVfs.getPosts + contentStore 派生视图，作为所有消费方的唯一入口。
 *
 * 数据源策略：
 * - init()：用 readonlyVfs 作为 reader（构建时静态数据，同步、零延迟、SSR 后立即可用）。
 * - refresh()：用 vfsStore 作为 reader（编辑器写入后，反映可写态）。
 *
 * SSR 安全：管道只在 browser 执行（init/refresh 内部判 browser）。
 * 响应式：通过 version 计数器暴露，消费方可用 contentQuery.version 触发 $derived 重算。
 */
import { browser } from "$app/environment";
import type { Collection } from "$lib/data/frontmatter";
import { readonlyVfs } from "$lib/vfs/readonly";
import { vfsStore } from "$lib/vfs/vfs.svelte";

import { pipelineExecutor } from "./executor";
import type { ContentEntry, VfsReader } from "./types";

/** 标签统计项。 */
export interface TagCount {
  tag: string;
  count: number;
}

// ---- reader 适配器 ----

/** readonlyVfs 适配为 VfsReader（同步内存读取）。 */
const readonlyReader: VfsReader = {
  readFile(path: string): string | null {
    return readonlyVfs.readFile(path);
  },
  readdir(prefix: string): string[] {
    return readonlyVfs.readdir(prefix).map((n) => n.path);
  },
};

/** vfsStore 适配为 VfsReader（读当前内存快照，不触发异步同步）。 */
function makeVfsStoreReader(): VfsReader {
  return {
    readFile(path: string): string | null {
      const node = vfsStore.files.find((f) => f.path === path);
      return node?.content ?? null;
    },
    readdir(prefix: string): string[] {
      const p = prefix.replace(/\/+$/, "");
      const withSlash = p ? `${p}/` : "";
      return vfsStore.files
        .filter((f) => (p ? f.path.startsWith(withSlash) : true))
        .map((f) => f.path);
    },
  };
}

/** 按 date 降序排序的复用工具。 */
function byDateDesc(a: ContentEntry, b: ContentEntry): number {
  return b.date.getTime() - a.date.getTime();
}

class ContentQuery {
  /** 管道执行版本（每次 init/refresh 自增，供消费方响应式追踪）。 */
  version = $state(0);

  /** 是否已初始化（至少跑过一次管道）。 */
  initialized = $state(false);

  /** 初始化管道（用 readonlyVfs 作为 reader）。幂等。 */
  init(): void {
    if (!browser) return;
    // 幂等：未初始化或 reader 缺失时跑一次；重复调用刷新只读快照
    pipelineExecutor.run(readonlyReader);
    this.version++;
    this.initialized = true;
  }

  /** 重新执行管道（编辑器写入后调用）。用 vfsStore 反映可写态。 */
  refresh(): void {
    if (!browser) return;
    pipelineExecutor.run(makeVfsStoreReader());
    this.version++;
    this.initialized = true;
  }

  // ---- 查询 API ----

  /** 所有文章（按 date 降序）。 */
  listArticles(opts?: { limit?: number }): ContentEntry[] {
    const entries = pipelineExecutor.getEntries("articles").slice().sort(byDateDesc);
    return opts?.limit ? entries.slice(0, opts.limit) : entries;
  }

  /** 所有说说/事件（按 date 降序）。 */
  listEvents(opts?: { limit?: number }): ContentEntry[] {
    const entries = pipelineExecutor.getEntries("events").slice().sort(byDateDesc);
    return opts?.limit ? entries.slice(0, opts.limit) : entries;
  }

  /** 全部内容合并（按 date 降序）。 */
  allPosts(): ContentEntry[] {
    return pipelineExecutor.getAllEntries().slice().sort(byDateDesc);
  }

  /** 标签频次（降序）。来自 tags processor 缓存，未注册时降级到本地计算。 */
  listTags(): TagCount[] {
    const result = pipelineExecutor.getResult("tags");
    if (result?.type === "tags") {
      return result.data as TagCount[];
    }
    // 降级：直接遍历全量 entries 统计
    return this.computeTags(pipelineExecutor.getAllEntries());
  }

  /** 带指定标签的所有内容（按 date 降序）。 */
  byTag(tag: string): ContentEntry[] {
    return this.allPosts().filter((e) => e.tags.includes(tag));
  }

  /** 按年份分组（年份降序）。 */
  groupByYear(entries: ContentEntry[]): Map<number, ContentEntry[]> {
    const groups = new Map<number, ContentEntry[]>();
    for (const entry of entries) {
      const year = entry.date.getFullYear();
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(entry);
    }
    return new Map([...groups.entries()].sort((a, b) => b[0] - a[0]));
  }

  /** 根据 collection + stem 查找单篇。 */
  findPost(collection: string, stem: string): ContentEntry | null {
    const entries = pipelineExecutor.getEntries(collection);
    return entries.find((e) => e.id.stem === stem) ?? null;
  }

  /** 同集合的所有内容（按 date 降序，供上下篇导航）。 */
  siblings(collection: string | Collection): ContentEntry[] {
    return pipelineExecutor.getEntries(collection).slice().sort(byDateDesc);
  }

  /** 统一 excerpt 查询（供消费方按需取摘要）。 */
  excerptFor(entry: ContentEntry): string {
    return entry.excerpt;
  }

  // ---- 内部工具 ----

  private computeTags(entries: ContentEntry[]): TagCount[] {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }
}

/** 全局单例。 */
export const contentQuery = new ContentQuery();
