/**
 * Gaubee Auth Worker —— GitHub OAuth + 图片上传。
 *
 * v2 架构（2026-07-27）：前端直连 api.github.com（token 在前端内存），
 * Worker 不再做 API 代理。职责缩减为：
 * 1. GET /auth/github          —— 重定向到 GitHub authorize URL（带 state 防 CSRF）
 * 2. GET /auth/github/callback —— code 换 token，通过 URL fragment 返回前端
 * 3. POST /upload/image        —— 图片上传（Issues 评论插图，用 token 调 Contents API）
 *
 * 安全要点：
 * - token 通过 URL hash fragment（#auth_token=...）返回前端，不发服务器/日志。
 * - 前端读 token 后立即清除地址栏 fragment，存内存 $state（刷新需重登）。
 * - state 用随机值 + Cookie 校验，防 CSRF。
 * - CORS 仅允许 APP_ORIGIN。
 */
import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";

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

/** OAuth state cookie（CSRF 防护，10 分钟有效）。 */
const STATE_COOKIE = "gh_oauth_state";

/** 是否为生产环境（state cookie 的 Secure 标记用）。 */
function isProd(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}

const app = new Hono<{ Bindings: Env }>();

// CORS：dev 允许 localhost 任意端口 + portless 的 *.localhost 域名，prod 严格 APP_ORIGIN。
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const isDev = c.env.ENVIRONMENT !== "production";
      // 开发环境：
      // - localhost/127.0.0.1 任意端口（vite 直连）
      // - *.localhost 任意端口（portless 自动域名，如 gaubee.com.localhost:5173）
      if (isDev && /^https?:\/\/([a-z0-9-]+\.)*localhost(:\d+)?$/.test(origin)) {
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

// ---- 图片上传（GithubApp Issues 评论插图 + GithubEditor 资产上传）----
// 前端发送 multipart（owner + repo + file，可选 path/branch），Worker 用 token 调
// GitHub Contents API PUT 上传，返回 raw URL。
// - path（可选）：目录前缀。提供则上传到 {path}/{filename}；否则默认 .github-issue-assets/
//   （向后兼容 Issue 评论插图）。
// - branch（可选）：指定分支。提供则 PUT 时带 ?ref={branch}。
app.post("/upload/image", async (c) => {
  // token 通过 Authorization header 传（新架构 token 在前端内存，非 cookie）
  const authHeader = c.req.header("Authorization");
  const effectiveToken = authHeader?.replace(/^Bearer\s+/i, "");
  if (!effectiveToken) {
    return c.json({ error: "unauthorized: upload requires login" }, 401);
  }
  const formData = await c.req.formData();
  const owner = formData.get("owner");
  const repo = formData.get("repo");
  const file = formData.get("file");
  // 可选参数（向后兼容：不传时走 Issue 评论默认行为）
  const dirPath = formData.get("path"); // 目录前缀（不带首尾斜杠）
  const branch = formData.get("branch"); // 目标分支
  if (typeof owner !== "string" || typeof repo !== "string" || !(file instanceof File)) {
    return c.json({ error: "invalid: owner/repo/file required" }, 400);
  }

  // 生成仓库内路径：
  // - dirPath 提供 → {dirPath}/{timestamp}-{rand}.{ext}
  // - 否则 → .github-issue-assets/{timestamp}-{rand}.{ext}（Issue 评论兼容）
  const ext = file.name.split(".").pop() || "png";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir =
    typeof dirPath === "string" && dirPath.trim()
      ? dirPath.replace(/^\/+|\/+$/g, "")
      : ".github-issue-assets";
  const path = `${dir}/${filename}`;

  // File → base64
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  // GitHub Contents API PUT（带可选 branch ref）
  const url = branch
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
    : `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${effectiveToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gaubee-auth-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `upload image: ${filename}`,
      content: base64,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return c.json({ error: `upload failed: ${resp.status} ${text}` }, resp.status);
  }
  const data = (await resp.json()) as { content: { download_url: string } };
  const downloadUrl = data.content.download_url;
  return c.json({ url: downloadUrl, path });
});

// ---- 1. 发起 OAuth：重定向到 GitHub ----
app.get("/auth/github", (c) => {
  const state = crypto.randomUUID();
  // redirect_uri 必须显式指定：反代（portless / Cloudflare）下 c.req.url 的 Host 不可靠，
  // 用 WORKER_ORIGIN 构造；未配置时回退到 c.req.url.origin（仅无反代直连场景安全）。
  const workerOrigin = c.env.WORKER_ORIGIN ?? new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${workerOrigin}/auth/github/callback`,
    // scope 说明：
    // - repo：读写用户有权限的仓库（含 org 仓库，GithubApp 浏览/提交）
    // - user：读写用户资料（头像/昵称等）
    // - read:org：读取用户的组织成员关系（GithubApp 列表页 user/orgs 需要，
    //   缺失时 GitHub 静默返回空数组而非 403）
    scope: "repo user read:org",
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

  // token 通过 URL hash fragment 返回前端（#auth_token=...）。
  // fragment 不会发到服务器/日志，比 query string 更安全。
  // 前端读取后立即从地址栏清除（存内存 $state，刷新需重登）。
  // 安全权衡：token 进前端内存，XSS 可读。代价是换取：
  // - 前端直连 api.github.com，零 Worker 代理消耗
  // - 无 Worker 白名单维护负担
  // 防护要求：严禁第三方 JS 注入（见 session.svelte.ts 注释 + CI CSP 检查）。
  const token = tokenData.access_token;
  return c.redirect(`${c.env.APP_ORIGIN}/#auth_token=${token}`);
});

export default app;
