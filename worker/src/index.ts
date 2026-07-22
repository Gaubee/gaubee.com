/**
 * Gaubee Auth Worker —— GitHub OAuth + API 代理。
 *
 * 职责：
 * 1. GET /auth/github        —— 重定向到 GitHub authorize URL（带 state 防 CSRF）
 * 2. GET /auth/github/callback —— code 换 access_token，设 httpOnly cookie，回应用
 * 3. POST /auth/logout       —— 清 cookie
 * 4. GET /auth/me            —— 返回当前用户信息（用 cookie token 调 GitHub /user）
 * 5. GET /api/proxy/*        —— 用 cookie token 代理 GitHub API（前端永不接触 token）
 *
 * 安全要点：
 * - token 只存在 httpOnly + Secure + SameSite=Lax cookie 里，JS 读不到。
 * - state 用随机值 + Cookie 校验，防 CSRF。
 * - CORS 仅允许 APP_ORIGIN。
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  APP_ORIGIN: string;
  /**
   * Worker 自身的对外 origin，用于构造 OAuth redirect_uri。
   * 反代（portless / Cloudflare）下 c.req.url 的 Host 不可靠，必须显式指定。
   * 未配置时回退到 c.req.url.origin（仅适合无反代的直连场景）。
   */
  WORKER_ORIGIN?: string;
  /** 部署环境：dev 时允许 localhost CORS，prod 严格白名单。 */
  ENVIRONMENT?: string;
}

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

const COOKIE_NAME = "gh_token";
const STATE_COOKIE = "gh_oauth_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

/**
 * 是否为生产环境。
 * dev 模式（ENVIRONMENT !== "production"）下 cookie 不加 Secure 标记：
 * 本地经 vite proxy（HTTP 内部转发）时，带 Secure 的 cookie 浏览器会拒绝存储。
 * portless 虽顶层是 HTTPS，但 vite→Worker 的内部连接是 HTTP，Secure cookie 丢失。
 * 生产（真 HTTPS 终端）保留 Secure。
 */
function isProd(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}

/** 代理路径限定：只允许访问本仓库。防 SSRF 到其他仓库。 */
const OWNER = "gaubee";
const REPO = "gaubee.com";
const ALLOWED_PROXY_PREFIX = `repos/${OWNER}/${REPO}/`;

const app = new Hono<{ Bindings: Env }>();

// CORS：dev 允许 localhost 任意端口，prod 严格 APP_ORIGIN。
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const isDev = c.env.ENVIRONMENT !== "production";
      // 开发环境：localhost/127.0.0.1 任意端口都允许
      if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return origin;
      }
      const allowed = c.env.APP_ORIGIN;
      return allowed === origin ? allowed : null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/", (c) => c.json({ name: "gaubee-auth", ok: true }));

// ---- 1. 发起 OAuth：重定向到 GitHub ----
app.get("/auth/github", (c) => {
  const state = crypto.randomUUID();
  // redirect_uri 必须显式指定：反代（portless / Cloudflare）下 c.req.url 的 Host 不可靠，
  // 用 WORKER_ORIGIN 构造；未配置时回退到 c.req.url.origin（仅无反代直连场景安全）。
  const workerOrigin = c.env.WORKER_ORIGIN ?? new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${workerOrigin}/auth/github/callback`,
    scope: "repo user",
    state,
  });
  // state 存 cookie，回调时校验防 CSRF
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: 600, // 10 分钟内必须完成回调
  });
  return c.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`);
});

// ---- 2. OAuth 回调：code 换 token，设 cookie，回应用 ----
app.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, STATE_COOKIE);

  // 清 state cookie（一次性）
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  if (!code || !state || state !== storedState) {
    return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=invalid_state`);
  }

  // code 换 access_token
  const tokenResp = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!tokenResp.ok) {
    return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=token_exchange`);
  }
  const tokenData = (await tokenResp.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenData.access_token) {
    return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=no_token`);
  }

  // token 存 httpOnly cookie
  setCookie(c, COOKIE_NAME, tokenData.access_token, {
    httpOnly: true,
    secure: isProd(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  // 回应用首页（带 ?auth=success 让前端显示成功提示）
  return c.redirect(`${c.env.APP_ORIGIN}/?auth=success`);
});

// ---- 3. 登出：清 cookie ----
app.post("/auth/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

// ---- 4. 当前用户信息 ----
app.get("/auth/me", async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) {
    return c.json({ authenticated: false }, 401);
  }
  const userResp = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // GitHub API 强制要求 User-Agent，否则返回 403
      "User-Agent": "gaubee-auth-worker",
    },
  });
  if (!userResp.ok) {
    return c.json({ authenticated: false }, 401);
  }
  const user = (await userResp.json()) as {
    login: string;
    name: string | null;
    avatar_url: string;
    id: number;
  };
  return c.json({
    authenticated: true,
    user: {
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      id: user.id,
    },
  });
});

// ---- 5. GitHub API 代理：前端所有 GitHub 调用走这里，token 从 cookie 取 ----
// - 路径限定为 repos/gaubee/gaubee.com/（防 SSRF 到其他仓库）
// - 写操作（POST/PUT/PATCH/DELETE）必须 token
// - 只读（GET/HEAD）无 token 时回退匿名请求（公开仓库可读，受 60/h 限速）
app.all("/api/proxy/*", async (c) => {
  // 解析目标路径：/api/proxy/repos/gaubee/.../contents → repos/gaubee/.../contents
  const url = new URL(c.req.url)
  // 去掉 /api/proxy 前缀与前导斜杠，规范化
  const ghPath = c.req.path.replace(/^\/api\/proxy\/?/, "")

  // 路径白名单校验：必须以 ALLOWED_PROXY_PREFIX 开头（防 SSRF 到其他仓库）
  const isAllowed =
    ghPath === ALLOWED_PROXY_PREFIX.slice(0, -1) || ghPath.startsWith(ALLOWED_PROXY_PREFIX)
  if (!isAllowed) {
    return c.json({ error: "forbidden: path not allowed" }, 403)
  }

  const token = getCookie(c, COOKIE_NAME)
  const method = c.req.method
  const isWrite = method !== "GET" && method !== "HEAD"
  // 写操作必须有 token（匿名不能写）
  if (isWrite && !token) {
    return c.json({ error: "unauthorized: write requires login" }, 401)
  }

  const targetUrl = `${GITHUB_API}/${ghPath}${url.search}`

  // 构造干净的请求头（白名单，删掉所有 proxy/client headers）
  const headers = new Headers()
  headers.set("Accept", "application/vnd.github+json")
  headers.set("User-Agent", "gaubee-auth-worker")
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }
  if (isWrite) {
    headers.set("Content-Type", "application/json")
  }

  const resp = await fetch(targetUrl, {
    method,
    headers,
    body: isWrite ? await c.req.text() : undefined,
  })

  // 透传响应
  const respHeaders = new Headers()
  respHeaders.set(
    "Content-Type",
    resp.headers.get("Content-Type") ?? "application/json",
  )
  respHeaders.set("Cache-Control", "no-store")
  // 透传 GitHub 的 rate limit 头（前端可据此提示）
  for (const h of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "ETag"]) {
    const v = resp.headers.get(h)
    if (v) respHeaders.set(h, v)
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  })
})

export default app;
