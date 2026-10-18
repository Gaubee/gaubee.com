/**
 * app.ts —— auth-server 主应用（worker/src/index.ts 的自托管移植，kzf 2026-10-18 裁决：
 * 登录/上传脱离 Cloudflare，迁国内服务器；头像反代留守 CF，见 auth-server/README.md）。
 *
 * 路由对齐 CF Worker 版（语义逐条照搬，改动力求最小）：
 * 1. GET  /                     —— 健康自检 JSON
 * 2. GET  /auth/github          —— 重定向 GitHub authorize（state cookie 防 CSRF）
 * 3. GET  /auth/github/callback —— code 换 token，URL fragment 回前端
 * 4. POST /upload/image         —— Bearer token 调 GitHub Contents API 上传插图
 * 5. /api/geo、/api/geo/rules   —— geo 规则（文件存储，见 geo-routes.ts；CF 版存 DO）
 * 6. GET  /twimg/*              —— 不再反代（源站不可达 pbs.twimg.com，实测连接层即断），
 *      302 到 twimg.tweb.xin（同 Worker 的 CF 自定义域），让存量页面里残旧的
 *      auth.gaubee.com/twimg 链接继续可用；白名单外保持 404 语义一致。
 *
 * 安全要点与 CF 版一致：token 走 URL fragment 不落服务器日志；state 随机 + Cookie 校验；
 * CORS 仅 APP_ORIGIN（dev 额外放行 localhost 系）；Cookie httpOnly + 10 分钟。
 */
import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";

import type { Env } from "./env";
import { createGeoRoutes } from "./geo-routes";
import type { GeoRulesStore } from "./geo-store";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** OAuth state cookie（CSRF 防护，10 分钟有效）。 */
const STATE_COOKIE = "gh_oauth_state";

/** twimg 头像反代的 CF 自定义域（kzf 2026-10-18 裁决：头像域名迁 tweb.xin）。 */
export const TWIMG_PROXY_ORIGIN = "https://twimg.tweb.xin";

/** 与 CF Worker /twimg 路由同一份前缀白名单（302 前本地先判，白名单外直接 404 不跳转）。 */
const TWIMG_PREFIXES = [
	"profile_images/",
	"media/",
	"ext_tw_video_thumb/",
	"card_img/",
	"emoji/",
];

/** 是否为生产环境（state cookie 的 Secure 标记用）。 */
function isProd(env: Env): boolean {
	return env.ENVIRONMENT === "production";
}

export function createApp(env: Env, store: GeoRulesStore): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();

	// CORS：dev 允许 localhost 系，prod 严格 APP_ORIGIN（与 CF 版同一逻辑）
	app.use(
		"*",
		cors({
			origin: (origin, c) => {
				const isDev = c.env.ENVIRONMENT !== "production";
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

	app.get("/", (c) => c.json({ name: "gaubee-auth-server", ok: true }));

	// ---- cdn-media 地区路由：/api/geo 公读 + /api/geo/rules owner 读写 ----
	app.route("/api/geo", createGeoRoutes(store));

	// ---- 图片上传（GithubApp Issues 评论插图 + GithubEditor 资产上传）----
	app.post("/upload/image", async (c) => {
		// token 通过 Authorization header 传（前端内存持有，非 cookie）
		const authHeader = c.req.header("Authorization");
		const effectiveToken = authHeader?.replace(/^Bearer\s+/i, "");
		if (!effectiveToken) {
			return c.json({ error: "unauthorized: upload requires login" }, 401);
		}
		const formData = await c.req.formData();
		const owner = formData.get("owner");
		const repo = formData.get("repo");
		const file = formData.get("file");
		const dirPath = formData.get("path"); // 目录前缀（不带首尾斜杠）
		const branch = formData.get("branch"); // 目标分支
		if (typeof owner !== "string" || typeof repo !== "string" || !(file instanceof File)) {
			return c.json({ error: "invalid: owner/repo/file required" }, 400);
		}

		const ext = file.name.split(".").pop() || "png";
		const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
		const dir =
			typeof dirPath === "string" && dirPath.trim()
				? dirPath.replace(/^\/+|\/+$/g, "")
				: ".github-issue-assets";
		const path = `${dir}/${filename}`;

		// File → base64（Bun/Node 均内置 btoa）
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
				"User-Agent": "gaubee-auth-server",
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
		return c.json({ url: data.content.download_url, path });
	});

	// ---- 1. 发起 OAuth：重定向到 GitHub ----
	app.get("/auth/github", (c) => {
		const state = crypto.randomUUID();
		// redirect_uri 显式指定：openresty 反代下 c.req.url 的 Host 需 vhost 配合，
		// 用 WORKER_ORIGIN 构造（与 CF 版同一约束）
		const workerOrigin = c.env.WORKER_ORIGIN ?? new URL(c.req.url).origin;
		const params = new URLSearchParams({
			client_id: c.env.GITHUB_CLIENT_ID,
			redirect_uri: `${workerOrigin}/auth/github/callback`,
			// scope 语义见 CF 版：repo + user + read:org
			scope: "repo user read:org",
			state,
		});
		setCookie(c, STATE_COOKIE, state, {
			httpOnly: true,
			secure: isProd(c.env),
			sameSite: "Lax",
			path: "/",
			maxAge: 600, // 10 分钟内必须完成回调
		});
		return c.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`);
	});

	// ---- 2. OAuth 回调：code 换 token，URL fragment 回前端 ----
	app.get("/auth/github/callback", async (c) => {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const storedState = getCookie(c, STATE_COOKIE);

		deleteCookie(c, STATE_COOKIE, { path: "/" });

		if (!code || !state || state !== storedState) {
			return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=invalid_state`);
		}

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

		// token 走 URL fragment：不发服务器/日志，前端读后立即清除地址栏（语义同 CF 版）
		const token = tokenData.access_token;
		return c.redirect(`${c.env.APP_ORIGIN}/#auth_token=${token}`);
	});

	// ---- twimg 头像：源站不做反代（不可达 pbs.twimg.com），302 到 CF 域 ----
	app.get("/twimg/*", (c) => {
		const path = c.req.path.slice("/twimg/".length);
		if (!TWIMG_PREFIXES.some((p) => path.startsWith(p))) {
			return c.json({ error: "path not allowed" }, 404);
		}
		const query = c.req.url.includes("?") ? `?${c.req.url.split("?")[1]}` : "";
		return c.redirect(`${TWIMG_PROXY_ORIGIN}/twimg/${path}${query}`, 302);
	});

	return app;
}
