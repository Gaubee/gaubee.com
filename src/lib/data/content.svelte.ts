/**
 * 内容聚合层（runes）：拉取并解析 articles/events，提供派生视图。
 *
 * 数据流：
 * 1. GitHub 列出 src/content/{articles,events}/*.md 文件清单
 * 2. 逐个读取（命中 IndexedDB 缓存则跳过网络）
 * 3. 解析 frontmatter + body
 * 4. 派生：allPosts（合并按 date 排序）/ postsByMonth / allTags
 *
 * 注意：未登录时也能拉取公开仓库内容（Worker 代理未认证时用匿名请求，
 * 受 GitHub 速率限制 60/小时；登录后 5000/小时）。
 */
import { browser } from "$app/environment";
import {
  getFileText,
  listCollectionFiles,
  type GhContentEntry,
} from "$lib/github/client";
import { getCachedContent, setCachedContent } from "$lib/db";
import {
  inferCollection,
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

class ContentStore {
  state = $state<ContentState>({
    loaded: false,
    loading: false,
    error: null,
    posts: [],
  });

  private inFlight: Promise<void> | null = null;

  /** 拉取并解析所有内容（幂等，并发合并）。 */
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
      // 并发拉取两个集合的文件清单
      const [articleEntries, eventEntries] = await Promise.all([
        listCollectionFiles("articles"),
        listCollectionFiles("events"),
      ]);

      // 逐个读取（带缓存）
      const allEntries = [
        ...articleEntries.map((e) => ({
          entry: e,
          collection: "articles" as Collection,
        })),
        ...eventEntries.map((e) => ({
          entry: e,
          collection: "events" as Collection,
        })),
      ];

      const posts: Post[] = [];
      // 串行读取避免触发 GitHub 速率限制（并发太多会被限）
      for (const { entry, collection } of allEntries) {
        try {
          const post = await this.loadPost(entry, collection);
          if (post) posts.push(post);
        } catch (e) {
          // 单篇失败不阻塞整体
          console.warn(`读取 ${entry.path} 失败:`, e);
        }
      }

      this.state.posts = posts;
      this.state.loaded = true;
    } catch (e) {
      this.state.error = e instanceof Error ? e.message : "内容加载失败";
    } finally {
      this.state.loading = false;
    }
  }

  private async loadPost(
    entry: GhContentEntry,
    collection: Collection,
  ): Promise<Post | null> {
    // 先查缓存（sha 匹配则跳过网络）
    const cached = await getCachedContent(entry.path);
    let text: string;
    if (cached && cached.sha === entry.sha) {
      text = cached.content;
    } else {
      text = await getFileText(entry.path);
      await setCachedContent(entry.path, text, entry.sha);
    }

    const { metadata, body } = parseMarkdown(text);
    const id = parseArticleId(entry.name);
    return {
      path: entry.path,
      collection,
      filename: entry.name,
      id,
      metadata: metadata ?? {
        date: new Date(0),
        tags: [],
      },
      body,
      sha: entry.sha,
    };
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

  /** 根据 collection + seq/slug 查找单篇。 */
  findPost(collection: Collection, stem: string): Post | undefined {
    return this.state.posts.find(
      (p) => p.collection === collection && p.id.stem === stem,
    );
  }
}

export const contentStore = new ContentStore();
