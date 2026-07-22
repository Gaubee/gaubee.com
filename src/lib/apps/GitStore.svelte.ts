/**
 * GitStore：基于 isomorphic-git 的公开仓库只读浏览器（GithubApp 私有实现）。
 *
 * 定位：
 * - 绑定任意公开 GitHub 仓库，匿名 clone/log（token 在 Worker httpOnly cookie，
 *   isomorphic-git 拿不到，故只能匿名操作公开仓库）。
 * - 与 GitService（走 VFS + Git Data API，认证有效）是两条独立路径：
 *   本 store 仅用于 GithubView 的「浏览公开仓库提交历史」，不参与编辑/发表。
 * - 编辑/发表/提交请走 GitService（gaubeeos.getAppService('git')）。
 *
 * Svelte 5 runes 响应式。
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

// ---------------------------------------------------------------------------
// 内存文件系统适配器（isomorphic-git 需要的接口）
// ---------------------------------------------------------------------------

class MemFS {
  files = new Map<string, string | Uint8Array>();

  private _get(path: string): string | Uint8Array | undefined {
    return this.files.get(path);
  }

  readFileSync = (path: string): Uint8Array => {
    const data = this._get(path);
    if (data === undefined) throw new Error(`ENOENT: ${path}`);
    if (typeof data === "string") return new TextEncoder().encode(data);
    return data;
  };

  writeFileSync = (path: string, data: string | Uint8Array): void => {
    this.files.set(path, data);
  };

  mkdirSync = (path: string, _opts?: { recursive?: boolean }): void => {
    // 内存中不需要实际创建目录，writeFile 时会自动处理
    this.files.set(path, new Uint8Array());
  };

  readdirSync = (path: string): string[] => {
    const prefix = path.endsWith("/") ? path : path + "/";
    const seen = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) seen.add(first);
      }
    }
    return [...seen];
  };

  statSync = (path: string): { isDirectory: () => boolean; size: number } => {
    const data = this._get(path);
    if (data !== undefined) {
      return {
        isDirectory: () => false,
        size: typeof data === "string" ? data.length : data.byteLength,
      };
    }
    // 检查是否是目录
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        return { isDirectory: () => true, size: 0 };
      }
    }
    throw new Error(`ENOENT: ${path}`);
  };

  lstatSync = this.statSync;

  unlinkSync = (path: string): void => {
    this.files.delete(path);
  };

  rmdirSync = (path: string): void => {
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  };

  existsSync = (path: string): boolean => {
    if (this.files.has(path)) return true;
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };

  // 适配 isomorphic-git 的 promisified 接口
  promises = {
    readFile: (path: string, _opts?: string): Promise<Uint8Array> =>
      Promise.resolve(this.readFileSync(path)),
    writeFile: (path: string, data: string | Uint8Array): Promise<void> =>
      Promise.resolve(this.writeFileSync(path, data)),
    mkdir: (path: string, opts?: { recursive?: boolean }): Promise<void> =>
      Promise.resolve(this.mkdirSync(path, opts)),
    readdir: (path: string): Promise<string[]> =>
      Promise.resolve(this.readdirSync(path)),
    stat: (
      path: string,
    ): Promise<{ isDirectory: () => boolean; size: number }> =>
      Promise.resolve(this.statSync(path)),
    lstat: (
      path: string,
    ): Promise<{ isDirectory: () => boolean; size: number }> =>
      Promise.resolve(this.lstatSync(path)),
    unlink: (path: string): Promise<void> =>
      Promise.resolve(this.unlinkSync(path)),
    rmdir: (path: string): Promise<void> =>
      Promise.resolve(this.rmdirSync(path)),
  };
}

// ---------------------------------------------------------------------------
// 状态（Svelte 5 runes）
// ---------------------------------------------------------------------------

class GitStore {
  /** 当前绑定的仓库。 */
  repo = $state<RepoConfig | null>(null);
  /** 内存文件系统。 */
  private fs = new MemFS();
  /** 当前分支。 */
  branch = $state("main");
  /** 提交历史。 */
  commits = $state<GitCommit[]>([]);
  /** 是否正在加载。 */
  loading = $state(false);
  /** 错误信息。 */
  error = $state<string | null>(null);

  // ---- 核心 Git 操作 ----

  /** 克隆仓库（匿名，仅公开仓库；token 在 Worker 端，isomorphic-git 拿不到）。 */
  async clone(config: RepoConfig): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const url = `https://github.com/${config.owner}/${config.repo}`;

      await git.clone({
        fs: this.fs as unknown as git.PromiseFsClient,
        http,
        dir: "/",
        url,
        ref: config.branch,
        corsProxy: "https://cors.isomorphic-git.org",
      });

      this.repo = config;
      this.branch = config.branch;
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.loading = false;
    }
  }

  /** 拉取最新变更。 */
  async pull(): Promise<void> {
    if (!this.repo) return;
    this.loading = true;
    this.error = null;
    try {
      await git.pull({
        fs: this.fs as unknown as git.PromiseFsClient,
        http,
        dir: "/",
        ref: this.branch,
        author: { name: "GaubeeOS", email: "os@gaubee.com" },
        corsProxy: "https://cors.isomorphic-git.org",
      });
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** 获取提交历史。 */
  async refresh(): Promise<void> {
    if (!this.repo) return;
    this.loading = true;
    this.error = null;
    try {
      const log = await git.log({
        fs: this.fs as unknown as git.PromiseFsClient,
        dir: "/",
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
