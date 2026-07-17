/**
 * GitHub 认证会话（runes）。
 *
 * - 通过 Worker 的 /auth/me 获取登录态（cookie httpOnly，前端读不到 token）。
 * - 所有 GitHub API 调用走 Worker 的 /api/proxy/* 代理，token 在 Worker 端注入。
 * - 未登录访问需鉴权视图时，跳 settings 提示登录。
 */
import { browser } from "$app/environment";

/** Worker 基础 URL。开发时本地 wrangler dev，生产环境变量配置。 */
export const AUTH_BASE =
  (import.meta.env.VITE_AUTH_BASE as string | undefined) ??
  "http://localhost:8787";

export interface GithubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  id: number;
}

interface SessionState {
  /** 是否已加载（初次 fetch /auth/me 完成）。 */
  loaded: boolean;
  /** 是否已认证。 */
  authenticated: boolean;
  /** 用户信息（authenticated 时有效）。 */
  user: GithubUser | null;
  /** 加载/登出时的错误信息。 */
  error: string | null;
}

class AuthStore {
  state = $state<SessionState>({
    loaded: false,
    authenticated: false,
    user: null,
    error: null,
  });

  private inFlight: Promise<void> | null = null;

  /** 拉取当前会话（幂等，并发合并）。 */
  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async doRefresh(): Promise<void> {
    if (!browser) return;
    try {
      const resp = await fetch(`${AUTH_BASE}/auth/me`, {
        credentials: "include",
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          authenticated: boolean;
          user?: GithubUser;
        };
        this.state.loaded = true;
        this.state.authenticated = data.authenticated;
        this.state.user = data.user ?? null;
        this.state.error = null;
      } else {
        this.state.loaded = true;
        this.state.authenticated = false;
        this.state.user = null;
      }
    } catch (e) {
      this.state.loaded = true;
      this.state.authenticated = false;
      this.state.error = e instanceof Error ? e.message : "会话检查失败";
    }
  }

  /** 跳转 GitHub 登录（Worker 重定向）。 */
  login(): void {
    if (!browser) return;
    window.location.href = `${AUTH_BASE}/auth/github`;
  }

  /** 登出。 */
  async logout(): Promise<void> {
    if (!browser) return;
    try {
      await fetch(`${AUTH_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // 忽略网络错误，本地状态照样清
    }
    this.state.authenticated = false;
    this.state.user = null;
  }

  /** 是否已登录（便捷派生）。 */
  get isAuthenticated(): boolean {
    return this.state.authenticated;
  }
}

export const authStore = new AuthStore();

// 浏览器启动时自动拉取一次会话
if (browser) {
  authStore.refresh();
}

/**
 * 封装对 GitHub API 的调用（走 Worker 代理）。
 * 路径不带前导斜杠，如 fetchGithub('repos/gaubee/gaubee.com/contents/src/content')。
 *
 * Worker 行为：
 * - GET/HEAD：无 token 时回退匿名请求（公开仓库可读，受 60/h 限速）
 * - POST/PUT/PATCH/DELETE：必须有 token（未登录返回 401）
 * - 路径限定 repos/gaubee/gaubee.com/（防 SSRF）
 */
export async function fetchGithub(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return fetch(`${AUTH_BASE}/api/proxy/${cleanPath}`, {
    ...init,
    credentials: "include",
  });
}
