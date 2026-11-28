/**
 * 统一内容查询层（单例）。
 *
 * 替代 readonlyVfs.getPosts + contentStore 派生视图，作为所有消费方的唯一入口。
 *
 * 数据源策略：
 * - init()：用构建期元数据索引（readonly-index，列表/摘要字段，无正文）。
 * - refresh()：用 vfsStore 作为 reader（编辑器写入后，反映可写态）。
 * - readBody()/readBodies()：正文按需从 /pages/raw 拉取并缓存（阅读时才算）。
 *
 * SSR 安全：管道只在 browser 执行（init/refresh 内部判 browser）。
 * 响应式：通过 version 计数器暴露，消费方可用 contentQuery.version 触发 $derived 重算。
 */
import { browser } from "$app/environment";
import { parseMarkdown, type ArticleMetadata, type Collection } from "$lib/data/frontmatter";
import { readonlyIndex } from "$lib/vfs/readonly-data";
import { readonlyVfs } from "$lib/vfs/readonly";
import { vfsStore } from "$lib/vfs/vfs.svelte";

import { pipelineExecutor } from "./executor";
import type { ContentEntry, VfsReader } from "./types";

/** 标签统计项。 */
export interface TagCount {
  tag: string;
  count: number;
}

// ---- 构建期元数据索引 → ContentEntry ----

/** 把 readonly-index 的序列化条目还原成运行时 ContentEntry（正文留空，按需补）。 */
function entryFromIndex(raw: (typeof readonlyIndex)[number]): ContentEntry {
  const metadata = {
    ...raw.metadata,
    date: new Date(raw.date),
    updated: raw.updated ? new Date(raw.updated) : undefined,
    tags: raw.tags,
  } as ArticleMetadata;

  return {
    uid: raw.path,
    path: raw.path,
    collection: raw.collection,
    filename: raw.filename,
    id: raw.id,
    title: raw.title,
    date: new Date(raw.date),
    updated: raw.updated ? new Date(raw.updated) : undefined,
    tags: raw.tags,
    body: "",
    excerpt: raw.excerpt,
    metadata,
  };
}

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

  /** 正文缓存（path → body），按需填充。 */
  private readonly bodyCache = new Map<string, string>();
  private readonly bodyInflight = new Map<string, Promise<string>>();

  private initTask: Promise<void> | null = null;
  private pending = false;

  /**
   * 初始化管道（构建期元数据索引）。
   *
   * 同一轮同步调用合并为一次执行：AppManager 注册各应用时会多次调用，
   * 这里用 microtask 等所有 source/processor 注册完再跑。
   */
  init(): Promise<void> {
    if (!browser) return Promise.resolve();
    this.pending = true;
    if (!this.initTask) {
      this.initTask = Promise.resolve().then(() => this.flushReadonly());
    }
    return this.initTask;
  }

  private flushReadonly(): void {
    while (this.pending) {
      this.pending = false;
      pipelineExecutor.runEntries(readonlyIndex.map(entryFromIndex));
      this.version++;
      this.initialized = true;
    }
    this.initTask = null;
  }

  /** 重新执行管道（编辑器写入后调用）。用 vfsStore 反映可写态。 */
  refresh(): void {
    if (!browser) return;
    pipelineExecutor.run(makeVfsStoreReader());
    this.version++;
    this.initialized = true;
  }

  // ---- 正文按需加载 ----

  /** 读取单篇正文（带缓存与并发合并）；不存在时返回空串。 */
  async readBody(entry: ContentEntry): Promise<string> {
    if (entry.body) return entry.body;

    const cached = this.bodyCache.get(entry.path);
    if (cached !== undefined) return cached;

    const pending = this.bodyInflight.get(entry.path);
    if (pending) return pending;

    const request = readonlyVfs
      .readFile(entry.path)
      .then((raw) => {
        const body = raw === null ? "" : parseMarkdown(raw).body;
        this.bodyCache.set(entry.path, body);
        return body;
      })
      .finally(() => {
        this.bodyInflight.delete(entry.path);
      });

    this.bodyInflight.set(entry.path, request);
    return request;
  }

  /** 批量读取正文，返回 path → body。 */
  async readBodies(entries: ContentEntry[]): Promise<Map<string, string>> {
    const bodies = await Promise.all(entries.map(async (entry) => {
      return [entry.path, await this.readBody(entry)] as const;
    }));
    return new Map(bodies);
  }

  // ---- 查询 API ----

  /** 所有文章（按 date 降序）。 */
  listArticles(opts?: { limit?: number }): ContentEntry[] {
    const entries = pipelineExecutor.getEntries("articles").slice().sort(byDateDesc);
    return opts?.limit ? entries.slice(0, opts.limit) : entries;
  }

  /** 所有事件（按 date 降序）。 */
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
