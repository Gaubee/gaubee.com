/**
 * GitHub 认证会话（runes）—— 前端直连 GitHub API。
 *
 * ⚠️ 安全模型：token 存前端内存（$state），非 httpOnly cookie，XSS 可读。
 * 这是有意的架构取舍——换取前端直连 api.github.com（零 Worker 代理消耗、无白名单）。
 *
 * 防护要求（必须遵守）：
 * - 严禁第三方 JS 注入（无 CDN script、无 eval、无 dangerouslySetInnerHTML 未消毒内容）。
 * - 推荐在 CI 中加 CSP 检查：第三方 JS 必须白名单，默认禁止注入。
 * - 这是 token 安全的唯一防线——一旦 XSS 注入执行，token 会泄露。
 *
 * token 生命周期：
 * - OAuth 回调后，Worker 重定向到 /#auth_token=xxx（hash fragment，不发服务器）。
 * - 前端启动时从 fragment 读取 token，存 $state（内存）+ localStorage（刷新恢复），
 *   立即清除地址栏 fragment。
 * - 刷新页面 → 从 localStorage 恢复 token，无需重新登录。
 * - token 失效（401/403）→ 清内存 + localStorage。
 * - 登出 → 清内存 + localStorage + 状态重置。
 */
import { browser } from "$app/environment";

/** Worker 基础 URL（仅用于 OAuth 发起/回调，不再用于 API 代理）。 */
export const AUTH_BASE =
  (import.meta.env.VITE_AUTH_BASE as string | undefined) ?? "http://localhost:8787";

/** GitHub API 基础 URL（前端直连）。 */
const GITHUB_API = "https://api.github.com";

export interface GithubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  id: number;
}

interface SessionState {
  /** 是否已加载（初次 fetch /user 完成）。 */
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

  /** GitHub access token（内存，不持久化）。 */
  private token: string | null = null;

  private inFlight: Promise<void> | null = null;

  /**
   * 从 URL fragment 读取 OAuth 回调的 token（#auth_token=xxx）。
   * 启动时调用一次，读取后立即清除地址栏 fragment（防泄露）。
   */
  consumeTokenFromFragment(): void {
    if (!browser) return;
    const hash = window.location.hash;
    const match = hash.match(/auth_token=([^&]+)/);
    if (match) {
      this.token = match[1];
      // 持久化到 localStorage（刷新时恢复，避免每次刷新都要重新登录）
      localStorage.setItem("gh_token", this.token);
      // 清除地址栏 fragment（history.replaceState，不触发导航）
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

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
    // 首次启动：从 fragment 消费 token（OAuth 回调），或从 localStorage 恢复（刷新）
    if (!this.token) {
      this.consumeTokenFromFragment();
    }
    if (!this.token && browser) {
      // fragment 无 token，尝试从 localStorage 恢复（页面刷新场景）
      const stored = localStorage.getItem("gh_token");
      if (stored) this.token = stored;
    }
    if (!this.token) {
      // 无 token：未登录
      this.state.loaded = true;
      this.state.authenticated = false;
      this.state.user = null;
      return;
    }
    try {
      // 用 token 直连 GitHub /user
      const resp = await fetch(`${GITHUB_API}/user`, {
        headers: this.authHeaders(),
      });
      if (!resp.ok) {
        // token 失效（401/403），清空 token + localStorage
        this.token = null;
        localStorage.removeItem("gh_token");
        this.state.loaded = true;
        this.state.authenticated = false;
        this.state.user = null;
        this.state.error = resp.status === 401 ? "会话已过期" : null;
        return;
      }
      const user = (await resp.json()) as GithubUser;
      this.state.loaded = true;
      this.state.authenticated = true;
      this.state.user = user;
      this.state.error = null;
    } catch (e) {
      this.state.loaded = true;
      this.state.authenticated = false;
      this.state.error = e instanceof Error ? e.message : "会话检查失败";
    }
  }

  /** 跳转 GitHub 登录（Worker 重定向发起 OAuth）。 */
  login(): void {
    if (!browser) return;
    window.location.href = `${AUTH_BASE}/auth/github`;
  }

  /** 登出（清内存 + localStorage token + 状态）。 */
  async logout(): Promise<void> {
    this.token = null;
    if (browser) localStorage.removeItem("gh_token");
    this.state.authenticated = false;
    this.state.user = null;
  }

  /** 是否已登录（便捷派生）。 */
  get isAuthenticated(): boolean {
    return this.state.authenticated;
  }

  /** 内部访问 token（同模块的 fetchGithub 用，不对外暴露）。 */
  get apiToken(): string | null {
    return this.token;
  }

  /** 构造 GitHub API 请求头（有 token 带 Authorization）。 */
  private authHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("User-Agent", "gaubee-app");
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    return headers;
  }
}

export const authStore = new AuthStore();

// 浏览器启动时自动拉取一次会话
if (browser) {
  authStore.refresh();
}

/**
 * 封装对 GitHub API 的直连调用（前端直连 api.github.com）。
 * 路径不带前导斜杠，如 fetchGithub('repos/gaubee/gaubee.com/contents/src/content')。
 *
 * - 有 token：带 Authorization，任意仓库可读写（权限由 token scope 决定）。
 * - 无 token：匿名请求（公开仓库可读，受 60/h 限速）。
 * - 写操作（POST/PUT/PATCH/DELETE）：必须有 token（GitHub 强制）。
 */
export async function fetchGithub(path: string, init?: RequestInit): Promise<Response> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/vnd.github+json");
  // GitHub API 强制要求 User-Agent
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "gaubee-app");
  }
  if (authStore.isAuthenticated) {
    // token 从 authStore 内存取（authStore 内部管理，不暴露）
    headers.set("Authorization", `Bearer ${authStore.apiToken}`);
  }
  return fetch(`${GITHUB_API}/${cleanPath}`, { ...init, headers });
}
