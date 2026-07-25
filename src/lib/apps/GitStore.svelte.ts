import { getFs, type ZenFs } from "$lib/fs/zenfs-instance";
/**
 * GitStore：基于 isomorphic-git 的公开仓库只读浏览器（GithubApp 私有实现）。
 *
 * 定位：
 * - 绑定任意公开 GitHub 仓库，匿名 clone/log（token 在 Worker httpOnly cookie，
 *   isomorphic-git 拿不到，故只能匿名操作公开仓库）。
 * - 与 GitService（走 VFS + Git Data API，认证有效）是两条独立路径：
 *   本 store 仅用于 GithubView 的「浏览公开仓库提交历史」，不参与编辑/发表。
 *   编辑/发表/提交请走 GitService（gaubeeos.getAppService('git')）。
 * - clone 结果持久化到 ZenFS（IndexedDB），刷新页面后历史仍在。
 *
 * Svelte 5 runes 响应式。
 *
 * 存储：使用 ZenFS 单例（@lib/fs/zenfs-instance），挂载点 /git。
 * isomorphic-git 的 PromiseFsClient 只要求 fs.promises.{readFile,...}，
 * ZenFS 原生提供该 promises 命名空间，直接作为 fs client 传入即可。
 */
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** 是否使用 GitHub OAuth 认证（否则用 public access）。 */
  authenticated: boolean;
}

export interface GitCommit {
  oid: string;
  message: string;
  author: { name: string; email: string; timestamp: number };
  parent: string[];
}

/** clone/pull 进度（isomorphic-git onProgress 回调格式）。 */
export interface CloneProgress {
  /** 阶段：Compressing objects / Receiving objects / Resolving deltas / Updating files 等 */
  phase: string;
  /** 已加载字节/对象数。 */
  loaded: number;
  /** 总字节/对象数（total > 0 时可计算百分比）。 */
  total: number;
}

// ---------------------------------------------------------------------------
// 状态（Svelte 5 runes）
// ---------------------------------------------------------------------------

/** isomorphic-git 的 clone 根目录（与主工作区 /workspace 分离）。 */
const GIT_ROOT = "/git";

class GitStore {
  /** 当前绑定的仓库。 */
  repo = $state<RepoConfig | null>(null);
  /** ZenFS fs 句柄（懒加载，首次 clone 时初始化）。 */
  private fsInstance: ZenFs | null = null;
  /** 当前分支。 */
  branch = $state("main");
  /** 提交历史。 */
  commits = $state<GitCommit[]>([]);
  /** 是否正在加载。 */
  loading = $state(false);
  /** 错误信息。 */
  error = $state<string | null>(null);
  /** clone/pull 进度（null = 无操作/完成）。 */
  progress = $state<CloneProgress | null>(null);

  /** 获取（懒加载）已初始化的 ZenFS 实例。 */
  private async fs(): Promise<ZenFs> {
    if (!this.fsInstance) {
      this.fsInstance = await getFs();
    }
    return this.fsInstance;
  }

  /** clone 前清空 /git 目录，避免上次 clone 残留污染本次。 */
  private async cleanGitRoot(): Promise<void> {
    const fs = await this.fs();
    try {
      await fs.promises.rm(GIT_ROOT, { recursive: true, force: true });
    } catch {
      // 不存在忽略
    }
    await fs.promises.mkdir(GIT_ROOT, { recursive: true });
  }

  // ---- 核心 Git 操作 ----

  /** 克隆仓库（匿名，仅公开仓库；token 在 Worker 端，isomorphic-git 拿不到）。 */
  async clone(config: RepoConfig): Promise<void> {
    this.loading = true;
    this.error = null;
    this.progress = { phase: "准备中", loaded: 0, total: 0 };
    try {
      const fs = await this.fs();
      await this.cleanGitRoot();
      const url = `https://github.com/${config.owner}/${config.repo}`;

      await git.clone({
        fs: fs as unknown as git.PromiseFsClient,
        http,
        dir: GIT_ROOT,
        url,
        ref: config.branch,
        corsProxy: "https://cors.isomorphic-git.org",
        onProgress: (p: CloneProgress) => {
          this.progress = p;
        },
      });

      this.repo = config;
      this.branch = config.branch;
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.loading = false;
      this.progress = null;
    }
  }

  /** 拉取最新变更。 */
  async pull(): Promise<void> {
    if (!this.repo) return;
    this.loading = true;
    this.error = null;
    this.progress = { phase: "拉取中", loaded: 0, total: 0 };
    try {
      const fs = await this.fs();
      await git.pull({
        fs: fs as unknown as git.PromiseFsClient,
        http,
        dir: GIT_ROOT,
        ref: this.branch,
        author: { name: "GaubeeOS", email: "os@gaubee.com" },
        corsProxy: "https://cors.isomorphic-git.org",
        onProgress: (p: CloneProgress) => {
          this.progress = p;
        },
      });
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
      this.progress = null;
    }
  }

  /** 获取提交历史。 */
  async refresh(): Promise<void> {
    if (!this.repo) return;
    this.loading = true;
    this.error = null;
    try {
      const fs = await this.fs();
      const log = await git.log({
        fs: fs as unknown as git.PromiseFsClient,
        dir: GIT_ROOT,
        ref: this.branch,
        depth: 50,
      });
      this.commits = log.map((c) => ({
        oid: c.oid,
        message: c.commit.message,
        author: c.commit.author,
        parent: c.commit.parent,
      }));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}

export const gitStore = new GitStore();
