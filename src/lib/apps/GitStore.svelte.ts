/**
 * GitStore：基于 isomorphic-git 的多仓库管理器（GithubApp 私有实现）。
 *
 * 定位：
 * - 管理多个已克隆的公开 GitHub 仓库（clone/pull/log/unshallow/remove）。
 * - 匿名操作（isomorphic-git 无 token，公开仓库只读）。
 * - clone 结果持久化到 ZenFS（IndexedDB），仓库列表持久化到 meta-store。
 * - 与 GitService（走 VFS + Git Data API，认证有效）是两条独立路径。
 *
 * 多仓库模型（2026-07-25）：
 * - repos: ManagedRepo[] — 已 clone 的仓库列表
 * - activeRepoId — 当前查看的仓库（单选）
 * - 路径规则：/repos/{owner}/{repo}（自动派生，可自定义）
 *
 * Svelte 5 runes 响应式。
 */
import { getFs, type ZenFs } from "$lib/fs/zenfs-instance";
import { repoPut, repoDelete, repoAll, type ManagedRepo } from "$lib/vfs/meta-store";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CloneOptions {
  owner: string;
  repo: string;
  branch: string;
  /** clone 目标路径。默认自动派生 /repos/{owner}/{repo}。 */
  dir?: string;
  /** 是否浅克隆（depth=1）。默认 true。 */
  shallow?: boolean;
}

export interface GitCommit {
  oid: string;
  message: string;
  author: { name: string; email: string; timestamp: number };
  parent: string[];
}

export interface CloneProgress {
  phase: string;
  loaded: number;
  total: number;
}

/** repos 挂载根（与主工作区 /workspace 分离）。 */
const REPOS_ROOT = "/repos";

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

class GitStore {
  /** 已克隆的仓库列表。 */
  repos = $state<ManagedRepo[]>([]);
  /** 当前激活的仓库 ID（owner/repo）。 */
  activeRepoId = $state<string | null>(null);
  /** ZenFS fs 句柄（懒加载）。 */
  private fsInstance: ZenFs | null = null;
  /** 提交历史（跟随 activeRepo）。 */
  commits = $state<GitCommit[]>([]);
  /** 是否正在加载（clone/pull/unshallow/refresh）。 */
  loading = $state(false);
  /** 错误信息。 */
  error = $state<string | null>(null);
  /** clone/pull 进度。 */
  progress = $state<CloneProgress | null>(null);
  /** 当前激活仓库是否为浅克隆。 */
  isShallow = $state(false);
  /** 是否已初始化（从 meta-store 恢复过 repos 列表）。 */
  initialized = $state(false);

  /** 当前激活的仓库对象。 */
  get activeRepo(): ManagedRepo | null {
    return this.repos.find((r) => r.id === this.activeRepoId) ?? null;
  }

  // ---- 初始化 ----

  /** 从 meta-store 恢复已克隆仓库列表（刷新后调用）。 */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.repos = await repoAll();
      // 默认激活第一个
      if (this.repos.length > 0 && !this.activeRepoId) {
        await this.switchRepo(this.repos[0].id);
      }
    } catch {
      // meta-store 未初始化，忽略
    }
  }

  // ---- 私有工具 ----

  private async fs(): Promise<ZenFs> {
    if (!this.fsInstance) {
      this.fsInstance = await getFs();
    }
    return this.fsInstance;
  }

  /** clone 前清空目标目录。 */
  private async cleanDir(dir: string): Promise<void> {
    const fs = await this.fs();
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // 不存在忽略
    }
    await fs.promises.mkdir(dir, { recursive: true });
  }

  /** 判断仓库是否为浅克隆（.git/shallow 文件存在）。 */
  private async checkShallow(dir: string): Promise<boolean> {
    const fs = await this.fs();
    try {
      await fs.promises.readFile(`${dir}/.git/shallow`);
      return true;
    } catch {
      return false;
    }
  }

  /** repo ID（owner/repo 格式）。 */
  private repoId(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  /** 自动派生 clone 目标路径。 */
  private defaultDir(owner: string, repo: string): string {
    return `${REPOS_ROOT}/${owner}/${repo}`;
  }

  // ---- 核心操作 ----

  /** 克隆仓库（匿名，仅公开仓库）。默认浅克隆。 */
  async clone(opts: CloneOptions): Promise<void> {
    const { owner, repo, branch } = opts;
    const id = this.repoId(owner, repo);
    const dir = opts.dir?.trim() || this.defaultDir(owner, repo);
    const shallow = opts.shallow ?? true;

    this.loading = true;
    this.error = null;
    this.progress = { phase: "准备中", loaded: 0, total: 0 };
    try {
      const fs = await this.fs();
      await this.cleanDir(dir);
      const url = `https://github.com/${owner}/${repo}`;

      await git.clone({
        fs: fs as unknown as git.PromiseFsClient,
        http,
        dir,
        url,
        ref: branch,
        corsProxy: "https://cors.isomorphic-git.org",
        depth: shallow ? 1 : undefined,
        singleBranch: true,
        // nonBlocking：checkout 阶段分批 yield 主线程，避免大量同步 fs 写入卡死 UI。
        // 浏览器必需（否则 checkout 写文件阻塞主线程，进度条停在 Compressing 100%）。
        nonBlocking: true,
        onProgress: (p: CloneProgress) => {
          this.progress = p;
        },
      });

      const record: ManagedRepo = {
        id,
        owner,
        repo,
        branch,
        dir,
        shallow,
        clonedAt: Date.now(),
      };
      await repoPut(record);

      // 更新列表 + 激活
      const existingIdx = this.repos.findIndex((r) => r.id === id);
      if (existingIdx >= 0) {
        this.repos[existingIdx] = record;
      } else {
        this.repos = [...this.repos, record];
      }
      await this.switchRepo(id);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.loading = false;
      this.progress = null;
    }
  }

  /** 切换当前仓库（重新加载提交历史）。 */
  async switchRepo(id: string): Promise<void> {
    this.activeRepoId = id;
    const repo = this.repos.find((r) => r.id === id);
    if (repo) {
      this.isShallow = await this.checkShallow(repo.dir);
      await this.refresh();
    }
  }

  /** 拉取最新变更（作用于 activeRepo）。 */
  async pull(): Promise<void> {
    const repo = this.activeRepo;
    if (!repo) return;
    this.loading = true;
    this.error = null;
    this.progress = { phase: "拉取中", loaded: 0, total: 0 };
    try {
      const fs = await this.fs();
      await git.pull({
        fs: fs as unknown as git.PromiseFsClient,
        http,
        dir: repo.dir,
        ref: repo.branch,
        author: { name: "GaubeeOS", email: "os@gaubee.com" },
        corsProxy: "https://cors.isomorphic-git.org",
        singleBranch: true,
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

  /** 深克隆（unshallow，作用于 activeRepo）。 */
  async unshallow(): Promise<void> {
    const repo = this.activeRepo;
    if (!repo || !this.isShallow) return;
    this.loading = true;
    this.error = null;
    this.progress = { phase: "深克隆中", loaded: 0, total: 0 };
    try {
      const fs = await this.fs();
      try {
        await fs.promises.unlink(`${repo.dir}/.git/shallow`);
      } catch {
        // 不存在忽略
      }
      await git.fetch({
        fs: fs as unknown as git.PromiseFsClient,
        http,
        dir: repo.dir,
        ref: repo.branch,
        remote: "origin",
        corsProxy: "https://cors.isomorphic-git.org",
        singleBranch: true,
        depth: 999999,
        relative: true,
        onProgress: (p: CloneProgress) => {
          this.progress = p;
        },
      });
      // 更新 meta（shallow=false）
      const updated = { ...repo, shallow: false };
      await repoPut(updated);
      const idx = this.repos.findIndex((r) => r.id === repo.id);
      if (idx >= 0) this.repos[idx] = updated;
      this.isShallow = false;
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
      this.progress = null;
    }
  }

  /** 移除仓库（删 ZenFS 目录 + meta 记录）。 */
  async removeRepo(id: string): Promise<void> {
    const repo = this.repos.find((r) => r.id === id);
    if (!repo) return;
    this.loading = true;
    this.error = null;
    try {
      const fs = await this.fs();
      await fs.promises.rm(repo.dir, { recursive: true, force: true });
      await repoDelete(id);
      this.repos = this.repos.filter((r) => r.id !== id);
      // 切换激活
      if (this.activeRepoId === id) {
        this.activeRepoId = this.repos[0]?.id ?? null;
        this.commits = [];
        this.isShallow = false;
        if (this.activeRepoId) {
          await this.switchRepo(this.activeRepoId);
        }
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** 获取提交历史（作用于 activeRepo）。 */
  async refresh(): Promise<void> {
    const repo = this.activeRepo;
    if (!repo) {
      this.commits = [];
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const fs = await this.fs();
      const log = await git.log({
        fs: fs as unknown as git.PromiseFsClient,
        dir: repo.dir,
        ref: repo.branch,
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

// 导出类型供 GithubView 使用
export type { ManagedRepo };
