/**
 * GitStore：基于 isomorphic-git 的 Git 操作封装。
 *
 * 设计目标：
 * - 绑定任意 GitHub 仓库（不只是 gaubee/gaubee.com）
 * - 纯前端运行（使用 CORS 代理处理 GitHub 请求）
 * - 提供完整的 git 能力：clone, log, diff, branch, add, commit, push
 * - Svelte 5 runes 响应式
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
      return { isDirectory: () => false, size: typeof data === "string" ? data.length : data.byteLength };
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
    stat: (path: string): Promise<{ isDirectory: () => boolean; size: number }> =>
      Promise.resolve(this.statSync(path)),
    lstat: (path: string): Promise<{ isDirectory: () => boolean; size: number }> =>
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
  /** 当前工作区变更的文件。 */
  changedFiles = $state<string[]>([]);
  /** 是否正在加载。 */
  loading = $state(false);
  /** 错误信息。 */
  error = $state<string | null>(null);

  /** 是否已经绑定仓库。 */
  get hasRepo(): boolean {
    return this.repo !== null;
  }

  // ---- 核心 Git 操作 ----

  /** 克隆仓库。 */
  async clone(config: RepoConfig): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const url = `https://github.com/${config.owner}/${config.repo}`;
      const token = this.getToken();
      const onAuth = token
        ? () => ({ username: "oauth2", password: token })
        : undefined;

      await git.clone({
        fs: this.fs as unknown as git.PromiseFsClient,
        http,
        dir: "/",
        url,
        defaultBranch: config.branch,
        ...(onAuth ? { onAuth } : {}),
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

      // 获取变更文件
      const status = await git.statusMatrix({
        fs: this.fs as unknown as git.PromiseFsClient,
        dir: "/",
        ref: this.branch,
      });
      this.changedFiles = status
        .filter(([, head, workdir, stage]) => head !== workdir || workdir !== stage)
        .map(([filepath]) => filepath);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** 添加文件到暂存区。 */
  async add(filepath: string): Promise<void> {
    await git.add({
      fs: this.fs as unknown as git.PromiseFsClient,
      dir: "/",
      filepath,
    });
    await this.refresh();
  }

  /** 提交变更。 */
  async commit(message: string): Promise<string> {
    if (!this.repo) throw new Error("未绑定仓库");
    const sha = await git.commit({
      fs: this.fs as unknown as git.PromiseFsClient,
      dir: "/",
      message,
      author: { name: "GaubeeOS", email: "os@gaubee.com" },
    });
    await this.refresh();
    return sha;
  }

  /** 推送到远程。 */
  async push(): Promise<void> {
    if (!this.repo) return;
    this.loading = true;
    this.error = null;
    try {
      const token = this.getToken();
      await git.push({
        fs: this.fs as unknown as git.PromiseFsClient,
        http,
        dir: "/",
        remote: "origin",
        ref: this.branch,
        onAuth: token ? () => ({ username: "oauth2", password: token }) : undefined,
        corsProxy: "https://cors.isomorphic-git.org",
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  // ---- 内部工具 ----

  private getToken(): string | null {
    // 从 authStore 获取 token（延迟导入避免循环依赖）
    try {
      const { authStore } = require("$lib/auth/session.svelte");
      return authStore.state.token ?? null;
    } catch {
      return null;
    }
  }
}

export const gitStore = new GitStore();
