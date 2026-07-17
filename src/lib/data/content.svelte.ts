/**
 * 内容聚合层（runes）：基于 VFS 的派生视图。
 *
 * v2：底层从"GitHub API + 自管缓存"改为"读 VFS + 解析 frontmatter"。
 * VFS 负责拉取/缓存/同步，本层只负责把 VFS 文件解析成 Post 派生视图。
 *
 * 保留原接口（articles/events/allPosts/postsByMonth/allTags/findPost），
 * 上层视图无需改动。
 */
import { browser } from "$app/environment";
import { vfsStore } from "$lib/vfs/vfs.svelte";
import {
  parseArticleId,
  parseMarkdown,
  type ArticleMetadata,
  type Collection,
} from "./frontmatter";

/** 一篇内容（article 或 event）的完整记录。 */
export interface Post {
  /** 文件在仓库的完整路径，如 'src/content/articles/0057.tc39-signals.md'。 */
  path: string;
  /** 集合：articles 或 events。 */
  collection: Collection;
  /** 文件名（含 .md）。 */
  filename: string;
  /** 解析后的 id。 */
  id: { seq: string; slug: string; stem: string };
  /** 元数据。 */
  metadata: ArticleMetadata;
  /** 正文（不含 frontmatter）。 */
  body: string;
  /** GitHub blob sha（用于变更检测）。 */
  sha: string;
}

interface ContentState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  posts: Post[];
}

/** 从 VFS 文件路径提取集合。路径形如 src/content/articles/xxx.md。 */
function collectionFromPath(path: string): Collection | null {
  if (path.startsWith("src/content/articles/")) return "articles";
  if (path.startsWith("src/content/events/")) return "events";
  return null;
}

class ContentStore {
  state = $state<ContentState>({
    loaded: false,
    loading: false,
    error: null,
    posts: [],
  });

  private inFlight: Promise<void> | null = null;

  /** 拉取并解析所有内容（幂等，并发合并）。底层委托 VFS.fetch。 */
  async refresh(): Promise<void> {
    if (!browser) return;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async doRefresh(): Promise<void> {
    this.state.loading = true;
    this.state.error = null;
    try {
      // 委托 VFS 同步（增量，Trees API）
      await vfsStore.sync("src/content");
      // 从 VFS 解析所有内容文件
      await this.reparse();
      this.state.loaded = true;
    } catch (e) {
      this.state.error = e instanceof Error ? e.message : "内容加载失败";
    } finally {
      this.state.loading = false;
    }
  }

  /** 从 vfsStore.files 重新解析 posts（VFS 变更后调用）。 */
  async reparse(): Promise<void> {
    const posts: Post[] = [];
    for (const node of vfsStore.files) {
      const collection = collectionFromPath(node.path);
      if (!collection) continue;
      const filename = node.path.split("/").pop() ?? node.path;
      const { metadata, body } = parseMarkdown(node.content ?? "");
      posts.push({
        path: node.path,
        collection,
        filename,
        id: parseArticleId(filename),
        metadata: metadata ?? { date: new Date(0), tags: [] },
        body,
        sha: node.sha ?? "",
      });
    }
    this.state.posts = posts;
  }

  // ---- 派生视图 ----

  /** 所有文章（按 date 降序）。 */
  get articles(): Post[] {
    return this.state.posts
      .filter((p) => p.collection === "articles")
      .sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime());
  }

  /** 所有短评（按 date 降序）。 */
  get events(): Post[] {
    return this.state.posts
      .filter((p) => p.collection === "events")
      .sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime());
  }

  /** 全部内容合并（按 date 降序）。 */
  get allPosts(): Post[] {
    return [...this.state.posts].sort(
      (a, b) => b.metadata.date.getTime() - a.metadata.date.getTime(),
    );
  }

  /** 按年月分组（feed 流用）。 */
  get postsByMonth(): Map<string, Post[]> {
    const map = new Map<string, Post[]>();
    for (const post of this.allPosts) {
      const d = post.metadata.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
    return map;
  }

  /** 所有标签（去重，含计数）。 */
  get allTags(): Map<string, number> {
    const map = new Map<string, number>();
    for (const post of this.state.posts) {
      for (const tag of post.metadata.tags) {
        map.set(tag, (map.get(tag) ?? 0) + 1);
      }
    }
    return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
  }

  /** 根据 collection + stem 查找单篇。 */
  findPost(collection: Collection, stem: string): Post | undefined {
    return this.state.posts.find(
      (p) => p.collection === collection && p.id.stem === stem,
    );
  }
}

export const contentStore = new ContentStore();
