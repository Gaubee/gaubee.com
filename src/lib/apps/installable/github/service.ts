/**
 * GitService：GitApp（Github 应用）提供的仓库操作能力接口。
 *
 * 这是「在浏览器中操作仓库内容」的统一抽象，收口两套历史路径：
 * 1. VFS + Git Data API（前端直连 api.github.com，认证有效）—— 写作/提交主路径。
 * 2. isomorphic-git GitStore —— GithubApp 的 clone/log/branch 功能（已降级为 CLI）。
 *
 * 发表等流程走 GitService，由它委托 VFS（认证有效路径）。
 * GitService 依赖 AccountService：commit 等写操作内部 require account 鉴权。
 *
 * 活动日志：commit/sync/revert 成功后调 activityLog.log()，记录 actor（callerId）、
 * action、message/sha/files，供 GithubApp 的「日志」Tab 展示。callerId 默认 'github'，
 * 可选参数向后兼容（现有调用方不传即用默认值）。
 */
import type { AppService } from "$lib/os/services";
import { NoChangesError } from "$lib/os/services";
import type { VfsNode } from "$lib/vfs/vfs";

/** 默认发起者标识（未显式传 callerId 时使用）。 */
export const DEFAULT_CALLER_ID = "github";

/** Git 服务接口。 */
export interface GitService extends AppService {
  readonly id: "git";
  readonly appId: "github";
  /**
   * 读取仓库文件（VFS 三层优先级：本地修改 > 远程缓存 > 在线拉取）。
   */
  readFile(path: string): Promise<string>;
  /** 写入文件到本地暂存（标记 dirty，未提交）。 */
  writeFile(path: string, content: string): Promise<void>;
  /** 列出所有 dirty（未提交修改/删除）的文件。 */
  dirtyFiles(): Promise<VfsNode[]>;
  /**
   * 提交所有 dirty 变更到 GitHub（Git Data API）。
   * 未登录抛 NotAuthenticatedError（内部 require accountService）。
   * @param message commit message
   * @param callerId 发起者标识（写入活动日志的 actor，默认 'github'）
   * @returns 新 commit sha
   */
  commit(message: string, callerId?: string): Promise<string>;
  /** 撤销单个文件的本地修改（恢复到远程状态）。@param callerId 活动日志 actor */
  revert(path: string, callerId?: string): Promise<void>;
  /** 从远程同步（Trees API 增量，不覆盖本地 dirty 修改）。@param callerId 活动日志 actor */
  sync(subtree?: string, callerId?: string): Promise<void>;
}

import { accountService } from "$lib/apps/builtin/account/service";
// 实现委托 VFS（Git Data API 路径，认证有效）。
// 注意依赖方向：gitService → vfs + accountService + activityLog（均纯单例，不经过 bus），
// 避免经过 gaubeeos/bus 产生循环依赖（bus → appManager → registry → github → bus）。
import { vfs, vfsStore } from "$lib/vfs/vfs.svelte";

import { activityLog, DEFAULT_REPO } from "./activity-log.svelte";

/**
 * GitService 单例实现：委托 VFS（Git Data API 路径，认证有效）。
 */
class GitServiceImpl implements GitService {
  readonly id = "git" as const;
  readonly appId = "github" as const;

  async readFile(path: string): Promise<string> {
    return vfs.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await vfsStore.write(path, content);
  }

  async dirtyFiles(): Promise<VfsNode[]> {
    return vfs.dirtyFiles();
  }

  async commit(message: string, callerId: string = DEFAULT_CALLER_ID): Promise<string> {
    // 登录守卫：写操作必须已登录
    accountService.requireAuthenticated();
    // 显式检查 dirty，抛出类型化错误（避免依赖 vfs 内部字符串）
    const dirty = await vfs.dirtyFiles();
    if (dirty.length === 0) throw new NoChangesError();
    const sha = await vfsStore.commit(message);
    // 记录活动日志（fire-and-forget，失败不影响 commit 结果）
    void activityLog.log({
      action: "commit",
      actor: callerId,
      repo: DEFAULT_REPO,
      details: {
        message,
        sha,
        files: dirty.map((f) => f.path),
      },
    });
    return sha;
  }

  async revert(path: string, callerId: string = DEFAULT_CALLER_ID): Promise<void> {
    await vfsStore.revert(path);
    void activityLog.log({
      action: "revert",
      actor: callerId,
      repo: DEFAULT_REPO,
      details: { files: [path] },
    });
  }

  async sync(subtree?: string, callerId: string = DEFAULT_CALLER_ID): Promise<void> {
    await vfsStore.sync(subtree);
    void activityLog.log({
      action: "sync",
      actor: callerId,
      repo: DEFAULT_REPO,
      details: subtree ? { message: `sync ${subtree}` } : {},
    });
  }
}

/** Git 服务单例。 */
export const gitService: GitService = new GitServiceImpl();
