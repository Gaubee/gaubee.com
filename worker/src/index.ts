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
}

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

const COOKIE_NAME = "gh_token";
const STATE_COOKIE = "gh_oauth_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

const app = new Hono<{ Bindings: Env }>();

// CORS：开发时允许 localhost 任意端口，生产仅允许 APP_ORIGIN。
// 用函数动态判断，支持 credentials。
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.APP_ORIGIN;
      // 开发环境：localhost/127.0.0.1 任意端口都允许
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return origin;
      }
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
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/github/callback`,
    scope: "repo user",
    state,
  });
  // state 存 cookie，回调时校验防 CSRF
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
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
    secure: true,
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
    headers: { Authorization: `Bearer ${token}` },
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
app.all("/api/proxy/*", async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }
  // /api/proxy/repos/gaubee/... → https://api.github.com/repos/gaubee/...
  const ghPath = c.req.path.replace(/^\/api\/proxy/, "");
  const url = `${GITHUB_API}${ghPath}${c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : ""}`;

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("origin");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github+json");
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }

  const resp = await fetch(url, {
    method: c.req.method,
    headers,
    body:
      c.req.method !== "GET" && c.req.method !== "HEAD"
        ? await c.req.text()
        : undefined,
  });

  // 透传响应，保留状态码
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
});

export default app;
