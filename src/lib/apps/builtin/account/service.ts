/**
 * AccountService：账户能力接口（GaubeeOS 应用服务总线的一部分）。
 *
 * 这是「账户」能力的正式抽象，封装现有 authStore（GitHub OAuth + Worker httpOnly cookie）。
 * 其它应用通过 gaubeeos.getAppService('account') 获取，不再直接 import authStore。
 *
 * 设计：
 * - state 是 Svelte 5 runes 响应式快照，组件用 $derived(accountService.state) 订阅。
 * - login/logout/refresh 委托底层 authStore，保持现有 OAuth 流程不变。
 * - requireAuthenticated() 是守卫：未登录抛 NotAuthenticatedError，调用方 catch 后引导登录。
 */
import type { AppService } from "$lib/os/services";
import { NotAuthenticatedError } from "$lib/os/services";
import { authStore, type GithubUser } from "$lib/auth/session.svelte";

/** 账户响应式快照（与 authStore.state 结构对齐，但对外屏蔽实现细节）。 */
export interface AccountSnapshot {
  /** 是否已完成首次会话拉取。 */
  loaded: boolean;
  /** 是否已认证（登录）。 */
  authenticated: boolean;
  /** 用户信息（authenticated 时有效）。 */
  user: AccountUser | null;
  /** 加载/登出时的错误信息。 */
  error: string | null;
}

/** 对外暴露的账户用户信息（与 GithubUser 对齐）。 */
export interface AccountUser {
  login: string;
  name: string | null;
  avatar_url: string;
  id: number;
}

/**
 * 账户服务不可用时的降级快照。
 * loaded:false 表示"尚未确认登录态"，视图据此显示骨架态而非伪装成"未登录"。
 */
export const ACCOUNT_UNAVAILABLE: AccountSnapshot = {
  loaded: false,
  authenticated: false,
  user: null,
  error: "账户服务不可用",
};

/** 账户服务接口。 */
export interface AccountService extends AppService {
  readonly id: "account";
  readonly appId: "account";
  /** 响应式快照（Svelte 5 runes）。 */
  readonly state: AccountSnapshot;
  /** 跳转到登录（GitHub OAuth，Worker 重定向）。 */
  login(): void;
  /** 登出。 */
  logout(): Promise<void>;
  /** 拉取当前会话（幂等，并发合并）。 */
  refresh(): Promise<void>;
  /** 是否已登录（便捷派生）。 */
  readonly isAuthenticated: boolean;
  /**
   * 守卫：未登录时抛 NotAuthenticatedError。
   * 调用方 try { account.requireAuthenticated(); ... } catch (e) { 引导登录 }。
   */
  requireAuthenticated(): void;
}

/**
 * AccountService 单例实现。
 *
 * 内部委托 authStore（保留为账户模块的私有实现细节，不再对外公开 import）。
 */
class AccountServiceImpl implements AccountService {
  readonly id = "account" as const;
  readonly appId = "account" as const;

  get state(): AccountSnapshot {
    // 直接投影 authStore.state（结构兼容 GithubUser → AccountUser）
    return authStore.state as unknown as AccountSnapshot;
  }

  get isAuthenticated(): boolean {
    return authStore.isAuthenticated;
  }

  login(): void {
    authStore.login();
  }

  async logout(): Promise<void> {
    await authStore.logout();
  }

  async refresh(): Promise<void> {
    await authStore.refresh();
  }

  requireAuthenticated(): void {
    if (!authStore.isAuthenticated) {
      throw new NotAuthenticatedError();
    }
  }
}

/** 账户服务单例。 */
export const accountService: AccountService = new AccountServiceImpl();

// 类型导出供 bus.ts 的 ServiceTypeMap 引用
export type { GithubUser };
