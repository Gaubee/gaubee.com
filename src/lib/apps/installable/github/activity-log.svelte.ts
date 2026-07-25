/**
 * ActivityLog：GithubApp 活动日志中心（记录各 App 的 git 操作）。
 *
 * 设计：
 * - 内存 `$state<GitActivity[]>` 提供响应式快照（日志 Tab 直接消费）。
 * - 持久化到 meta-store 的 `activities` store（IndexedDB），刷新后恢复。
 * - GitService 的 commit/sync/revert 成功后调用 activityLog.log() 记录，
 *   actor = callerId（默认 'github'），便于追溯哪个 App/流程触发了变更。
 *
 * 这是一个纯单例 store（不经 bus），与 gitService / vfsStore 同层，
 * 由 gitService 直接 import 调用，避免经过 gaubeeos/bus 产生循环依赖。
 */
import { browser } from "$app/environment";
import { activityAll, activityPut, type GitActivity } from "$lib/vfs/meta-store";

export type { GitActivity };

/** 生成活动 ID：时间戳 + 随机后缀，保证唯一。 */
function makeId(timestamp: number): string {
  return `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

class ActivityLog {
  /** 内存中的活动列表（响应式，最新在前）。 */
  private _activities = $state<GitActivity[]>([]);
  /** 是否已初始化（init 从 meta-store 恢复过）。 */
  initialized = $state(false);
  /** 是否正在初始化（避免并发 init）。 */
  private initInFlight: Promise<void> | null = null;
  /** 内存上限（超出裁剪最旧条目，避免无限增长）。 */
  private readonly MAX_KEEP = 500;

  /** 活动列表（最新在前）。 */
  get activities(): GitActivity[] {
    return this._activities;
  }

  /** 从 meta-store 恢复历史活动（幂等，并发合并）。 */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initInFlight) return this.initInFlight;
    this.initInFlight = this.doInit();
    try {
      await this.initInFlight;
    } finally {
      this.initInFlight = null;
    }
  }

  private async doInit(): Promise<void> {
    if (!browser) {
      this.initialized = true;
      return;
    }
    try {
      const all = await activityAll();
      // 按时间倒序（最新在前）
      all.sort((a, b) => b.timestamp - a.timestamp);
      this._activities = all.slice(0, this.MAX_KEEP);
    } catch {
      // meta-store 未就绪，忽略（保持空列表）
    } finally {
      this.initialized = true;
    }
  }

  /**
   * 记录一条活动：写入内存（头部）+ 持久化到 meta-store。
   * 超出上限时裁剪内存中最旧的条目（持久化层保留全部，仅内存裁剪）。
   */
  async log(
    activity: Omit<GitActivity, "id" | "timestamp"> & {
      timestamp?: number;
    },
  ): Promise<GitActivity> {
    const full: GitActivity = {
      id: makeId(activity.timestamp ?? Date.now()),
      timestamp: activity.timestamp ?? Date.now(),
      action: activity.action,
      actor: activity.actor,
      repo: activity.repo,
      details: activity.details ?? {},
    };
    // 头部插入（最新在前）
    this._activities = [full, ...this._activities].slice(0, this.MAX_KEEP);
    if (browser) {
      try {
        await activityPut(full);
      } catch {
        // 持久化失败不影响内存（日志非关键路径）
      }
    }
    return full;
  }

  /** 清空所有活动（内存 + 持久化）。主要供测试/重置使用。 */
  async clear(): Promise<void> {
    this._activities = [];
    if (browser) {
      const { activityClear } = await import("$lib/vfs/meta-store");
      try {
        await activityClear();
      } catch {
        // 忽略
      }
    }
  }
}

/** 活动日志单例。 */
export const activityLog = new ActivityLog();

/** 默认 repo 标识（与 github/client 的 OWNER/REPO 对齐）。 */
export const DEFAULT_REPO = "gaubee/gaubee.com";
