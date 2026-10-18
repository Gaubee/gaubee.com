/**
 * app.test.ts —— 路由语义测试（对齐 worker/src/index.test.ts 的关键用例，自托管差异另测）：
 * OAuth state 防 CSRF、回调 fragment 回传、上传鉴权门、twimg 302 白名单、geo 读写全链路（fetch 桩）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, TWIMG_PROXY_ORIGIN } from "../src/app";
import type { Env } from "../src/env";
import { GeoRulesStore } from "../src/geo-store";

const env: Env = {
	APP_ORIGIN: "https://gaubee.com",
	WORKER_ORIGIN: "https://auth.gaubee.com",
	ENVIRONMENT: "production",
	OWNER_LOGIN: "gaubee",
	GITHUB_CLIENT_ID: "client-id-test",
	GITHUB_CLIENT_SECRET: "client-secret-test",
	GEO_RULES_PATH: join(mkdtempSync(join(tmpdir(), "auth-app-")), "geo-rules.json"),
};

/** 建应用并返回绑定 Bindings 的请求函数（app.request 第三参才是 env）。 */
function makeApp() {
	const app = createApp(env, new GeoRulesStore(env.GEO_RULES_PATH!));
	return (path: string, init?: RequestInit) => app.request(path, init, env);
}

function githubUserFetch(login: string | null) {
	return async (input: string | URL | Request): Promise<Response> => {
		const url = String(input instanceof Request ? input.url : input);
		if (url === "https://api.github.com/user") {
			if (!login) return new Response("bad credentials", { status: 401 });
			return Response.json({ login });
		}
		if (url === "https://github.com/login/oauth/access_token") {
			return Response.json({ access_token: "tok-123" });
		}
		return new Response(`unexpected fetch: ${url}`, { status: 599 });
	};
}

beforeEach(() => {
	vi.stubGlobal("fetch", vi.fn(githubUserFetch("gaubee")));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("基础路由", () => {
	it("GET / 健康自检", async () => {
		const res = await makeApp()("/");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ name: "gaubee-auth-server", ok: true });
	});
});

describe("OAuth", () => {
	it("/auth/github 重定向 authorize 并种 state cookie", async () => {
		const res = await makeApp()("/auth/github");
		expect(res.status).toBe(302);
		const loc = res.headers.get("Location")!;
		expect(loc.startsWith("https://github.com/login/oauth/authorize?")).toBe(true);
		const params = new URLSearchParams(loc.split("?")[1]);
		expect(params.get("client_id")).toBe("client-id-test");
		expect(params.get("redirect_uri")).toBe("https://auth.gaubee.com/auth/github/callback");
		const setCookie = res.headers.get("Set-Cookie")!;
		expect(setCookie).toContain("gh_oauth_state=");
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("Secure");
	});

	it("回调 state 不匹配 → invalid_state 回前端", async () => {
		const res = await makeApp()("/auth/github/callback?code=c&state=wrong", {
			headers: { cookie: "gh_oauth_state=right" },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("https://gaubee.com/?auth_error=invalid_state");
	});

	it("回调成功 → fragment 携带 token 回 APP_ORIGIN", async () => {
		const res = await makeApp()("/auth/github/callback?code=c&state=s", {
			headers: { cookie: "gh_oauth_state=s" },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("https://gaubee.com/#auth_token=tok-123");
	});
});

describe("上传", () => {
	it("无 Authorization → 401", async () => {
		const form = new FormData();
		form.set("owner", "gaubee");
		form.set("repo", "gaubee.com");
		form.set("file", new File(["x"], "a.png"));
		const res = await makeApp()("/upload/image", { method: "POST", body: form });
		expect(res.status).toBe(401);
	});

	it("缺 owner/repo/file → 400", async () => {
		const res = await makeApp()("/upload/image", {
			method: "POST",
			headers: { Authorization: "Bearer tok" },
			body: new FormData(),
		});
		expect(res.status).toBe(400);
	});
});

describe("twimg 302", () => {
	it("白名单内 → 302 到 CF 域并保留 query", async () => {
		const res = await makeApp()("/twimg/profile_images/1/x_bigger.jpg?name=hi");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(`${TWIMG_PROXY_ORIGIN}/twimg/profile_images/1/x_bigger.jpg?name=hi`);
	});

	it("白名单外 → 404 不跳转", async () => {
		const res = await makeApp()("/twimg/evil/path.jpg");
		expect(res.status).toBe(404);
	});
});

describe("geo 路由", () => {
	it("GET /api/geo：默认规则 + private no-store", async () => {
		const res = await makeApp()("/api/geo");
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		const body = (await res.json()) as { mediaBase: string; ruleVersion: number };
		expect(body).toEqual({ mediaBase: "", ruleVersion: 0 });
	});

	it("PUT /api/geo/rules：无 token 401；非 owner 403", async () => {
		const rq = makeApp();
		const doc = JSON.stringify({ version: 1, rules: [] });
		const unauth = await rq("/api/geo/rules", { method: "PUT", body: doc });
		expect(unauth.status).toBe(401);

		vi.stubGlobal("fetch", vi.fn(githubUserFetch("someone-else")));
		const forbidden = await rq("/api/geo/rules", {
			method: "PUT",
			headers: { Authorization: "Bearer tok" },
			body: doc,
		});
		expect(forbidden.status).toBe(403);
	});

	it("PUT /api/geo/rules：owner 写 200；CAS 冲突 409；读回显", async () => {
		const rq = makeApp();
		const doc = JSON.stringify({ version: 1, rules: [{ match: { default: true }, mediaBase: "" }] });
		const ok = await rq("/api/geo/rules", {
			method: "PUT",
			headers: { Authorization: "Bearer tok" },
			body: doc,
		});
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ ok: true, ruleVersion: 1 });

		const conflict = await rq("/api/geo/rules", {
			method: "PUT",
			headers: { Authorization: "Bearer tok" },
			body: doc,
		});
		expect(conflict.status).toBe(409);
		expect(((await conflict.json()) as { currentVersion: number }).currentVersion).toBe(1);

		const read = await rq("/api/geo/rules", { headers: { Authorization: "Bearer tok" } });
		expect(read.status).toBe(200);
		const payload = (await read.json()) as { fromDefault: boolean; rules: { version: number; rules: unknown[] } };
		expect(payload.fromDefault).toBe(false);
		expect(payload.rules.version).toBe(1);
		expect(payload.rules.rules).toHaveLength(1);

		const geo = await rq("/api/geo");
		expect(((await geo.json()) as { ruleVersion: number }).ruleVersion).toBe(1);
	});

	it("PUT 非法 schema → 400", async () => {
		const res = await makeApp()("/api/geo/rules", {
			method: "PUT",
			headers: { Authorization: "Bearer tok" },
			body: JSON.stringify({ version: 1, rules: [], extra: 1 }),
		});
		expect(res.status).toBe(400);
	});
});
