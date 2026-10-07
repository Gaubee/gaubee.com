/**
 * worker 单测（cdn-media-bootstrap Phase 2，A6 + r9 复评修复）：
 * - GET /api/geo：默认规则回退（无 KV/KV 空/无 cf）、country 命中、外部 base 返回、
 *   响应头 private, no-store（r9 P1-1：地区结果禁入共享缓存）。
 * - GET|PUT /api/geo/rules：owner 鉴权（401 无 token / 401 坏 token / 403 非 owner /
 *   403 OWNER_LOGIN 未配置 fail-closed）、owner 写 200 + KV 落库、schema 非法 400、限流 429、
 *   版本服务端单调（r9 P1-2：重复/回退/跳跃 409 带 currentVersion，严格 +1 200，首写正整数）、
 *   写审计行带 cfCountry（r9 P1-4）。
 * HTTP 层用 Hono app.request() 真实分发；KV 内存实现；GitHub /user 用 fetch stub。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GEO_RULES, GEO_RULES_KV_KEY, type GeoRules } from "../../src/lib/geo/contract";
import type { Env, GeoKV } from "./env";
import app from "./index";

/** 内存 KV（满足 GeoKV 结构面即可，真实 KVNamespace 结构兼容）。 */
class MemKV implements GeoKV {
	store = new Map<string, string>();
	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}
}

function baseEnv(overrides?: Partial<Env>): Env {
	return {
		GITHUB_CLIENT_ID: "test-id",
		GITHUB_CLIENT_SECRET: "test-secret",
		APP_ORIGIN: "https://gaubee.com.localhost",
		OWNER_LOGIN: "gaubee",
		...overrides,
	};
}

/** 构造带/不带 CF 地理信息的 GET /api/geo 请求（cf 经 defineProperty 挂上，模拟 workerd 注入）。 */
function geoRequest(cf?: { country?: string; continent?: string }): Request {
	const req = new Request("https://worker.test/api/geo");
	if (cf) Object.defineProperty(req, "cf", { value: cf });
	return req;
}

/** stub 全局 fetch：模拟 GitHub /user 返回（null → 401 形态）。 */
function stubGithubLogin(login: string | null): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (): Promise<Response> =>
			new Response(JSON.stringify(login === null ? { message: "Bad credentials" } : { login }), {
				status: login === null ? 401 : 200,
			}),
		),
	);
}

const VALID_RULES: GeoRules = {
	version: 3,
	rules: [
		{ match: { countries: ["CN"] }, mediaBase: "https://esa.example.com" },
		{ match: { default: true }, mediaBase: "" },
	],
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("GET /api/geo（公读）", () => {
	it("默认规则回退：无 KV binding → 同源 + version 0（A8）", async () => {
		const res = await app.request(geoRequest({ country: "CN", continent: "AS" }), undefined, baseEnv());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ mediaBase: "", ruleVersion: 0 });
	});

	it("默认规则回退：KV 无值 → 同源", async () => {
		const env = baseEnv({ GEO_RULES: new MemKV() });
		const res = await app.request(geoRequest({ country: "CN" }), undefined, env);
		expect(await res.json()).toEqual({ mediaBase: "", ruleVersion: 0 });
	});

	it("country 命中：CN → 外部 base；US → default 同源；返回 ruleVersion", async () => {
		const kv = new MemKV();
		kv.store.set(GEO_RULES_KV_KEY, JSON.stringify(VALID_RULES));
		const env = baseEnv({ GEO_RULES: kv });

		const cn = await app.request(geoRequest({ country: "CN", continent: "AS" }), undefined, env);
		expect(cn.status).toBe(200);
		expect(await cn.json()).toEqual({ mediaBase: "https://esa.example.com", ruleVersion: 3 });

		const us = await app.request(geoRequest({ country: "US", continent: "NA" }), undefined, env);
		expect(await us.json()).toEqual({ mediaBase: "", ruleVersion: 3 });
	});

	it("无 cf（本地 wrangler dev 常态）→ 跳过地区条件，落 default 规则", async () => {
		const kv = new MemKV();
		kv.store.set(GEO_RULES_KV_KEY, JSON.stringify(VALID_RULES));
		const res = await app.request(geoRequest(), undefined, baseEnv({ GEO_RULES: kv }));
		expect(await res.json()).toEqual({ mediaBase: "", ruleVersion: 3 });
		expect(DEFAULT_GEO_RULES.version).toBe(0);
	});

	it("响应头 private, no-store（r9 P1-1：地区结果禁入共享缓存，CF 默认 cache key 不含 country）", async () => {
		const res = await app.request(geoRequest({ country: "CN" }), undefined, baseEnv());
		expect(res.headers.get("cache-control")).toBe("private, no-store");
	});
});

describe("GET /api/geo/rules（owner 读）", () => {
	it("owner 读：KV 为空时回显默认规则 + fromDefault 标记", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			"/api/geo/rules",
			{ headers: { Authorization: "Bearer tok" } },
			baseEnv({ GEO_RULES: new MemKV() }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rules: DEFAULT_GEO_RULES, fromDefault: true });
	});
});

describe("PUT /api/geo/rules（owner 写）", () => {
	const putInit = (token?: string, body?: unknown): RequestInit => ({
		method: "PUT",
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body ?? VALID_RULES),
	});

	it("无 token → 401", async () => {
		const res = await app.request("/api/geo/rules", putInit(), baseEnv());
		expect(res.status).toBe(401);
	});

	it("GitHub token 无效 → 401", async () => {
		stubGithubLogin(null);
		const res = await app.request("/api/geo/rules", putInit("bad-token"), baseEnv());
		expect(res.status).toBe(401);
	});

	it("非 owner → 403（login 与 OWNER_LOGIN 不匹配）", async () => {
		stubGithubLogin("attacker");
		const res = await app.request("/api/geo/rules", putInit("tok"), baseEnv());
		expect(res.status).toBe(403);
	});

	it("OWNER_LOGIN 未配置 → 403（fail-closed）", async () => {
		stubGithubLogin("gaubee");
		const env = baseEnv({ OWNER_LOGIN: undefined });
		const res = await app.request("/api/geo/rules", putInit("tok"), env);
		expect(res.status).toBe(403);
	});

	it("owner 写 → 200，login 大小写不敏感，且 KV 落库可回读", async () => {
		stubGithubLogin("Gaubee");
		const kv = new MemKV();
		const res = await app.request("/api/geo/rules", putInit("tok"), baseEnv({ GEO_RULES: kv }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 3 });

		const stored = kv.store.get(GEO_RULES_KV_KEY);
		expect(stored).toBeTruthy();
		expect(JSON.parse(stored as string)).toEqual(VALID_RULES);

		// 写入后 /api/geo 立即反映新规则
		const geo = await app.request(
			geoRequest({ country: "CN" }),
			undefined,
			baseEnv({ GEO_RULES: kv }),
		);
		expect(await geo.json()).toEqual({ mediaBase: "https://esa.example.com", ruleVersion: 3 });
	});

	it("schema 非法 → 400（version 类型错误）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			"/api/geo/rules",
			putInit("tok", { version: "x", rules: [] }),
			baseEnv({ GEO_RULES: new MemKV() }),
		);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error?: string };
		expect(data.error).toContain("version");
	});

	it("限流：同 IP 超过写窗口上限 → 429（独立 IP 桶，放最后防串扰）", async () => {
		stubGithubLogin("gaubee");
		const ip = "203.0.113.9";
		let last = 200;
		for (let i = 0; i < 21; i++) {
			const res = await app.request(
				"/api/geo/rules",
				{ ...putInit("tok"), headers: { ...putInit("tok").headers, "CF-Connecting-IP": ip } },
				baseEnv({ GEO_RULES: new MemKV() }),
			);
			last = res.status;
			if (res.status === 429) break;
		}
		expect(last).toBe(429);
	});
});

describe("PUT /api/geo/rules 版本服务端单调（r9 P1-2）", () => {
	/** 预置 KV 已有 version=3 规则文档的 env（含 KV 引用，供落库断言）。 */
	function envWithRules(rules: GeoRules): { env: Env; kv: MemKV } {
		const kv = new MemKV();
		kv.store.set(GEO_RULES_KV_KEY, JSON.stringify(rules));
		return { env: baseEnv({ GEO_RULES: kv }), kv };
	}

	/**
	 * 带独立 IP 的 owner 写请求（cf 可选挂载，模拟 workerd 注入）。
	 * 限流桶按 IP 分桶：本组用例各自独立 IP，避免与前序用例共用 unknown 桶误触 429。
	 */
	function putRequest(ip: string, body: unknown, cf?: { country?: string }): Request {
		const req = new Request("https://worker.test/api/geo/rules", {
			method: "PUT",
			headers: {
				Authorization: "Bearer tok",
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify(body),
		});
		if (cf) Object.defineProperty(req, "cf", { value: cf });
		return req;
	}

	it("首次写入（KV 为空）→ 任意正整数 version 接受", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.101", { ...VALID_RULES, version: 5 }),
			undefined,
			baseEnv({ GEO_RULES: new MemKV() }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 5 });
	});

	it("首次写入 version 0 → 400（与内置默认规则 v0 撞代次，拒收）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.102", { ...VALID_RULES, version: 0 }),
			undefined,
			baseEnv({ GEO_RULES: new MemKV() }),
		);
		expect(res.status).toBe(400);
	});

	it("同 version 重复写 → 409，响应带 currentVersion", async () => {
		stubGithubLogin("gaubee");
		const { env } = envWithRules(VALID_RULES);
		const res = await app.request(putRequest("203.0.113.103", VALID_RULES), undefined, env);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: "version conflict: current 3, expected 4",
			currentVersion: 3,
		});
	});

	it("版本回退 → 409", async () => {
		stubGithubLogin("gaubee");
		const { env } = envWithRules(VALID_RULES);
		const res = await app.request(
			putRequest("203.0.113.104", { ...VALID_RULES, version: 2 }),
			undefined,
			env,
		);
		expect(res.status).toBe(409);
	});

	it("版本跳跃（+2）→ 409（严格 +1）", async () => {
		stubGithubLogin("gaubee");
		const { env } = envWithRules(VALID_RULES);
		const res = await app.request(
			putRequest("203.0.113.105", { ...VALID_RULES, version: 5 }),
			undefined,
			env,
		);
		expect(res.status).toBe(409);
	});

	it("严格 +1 → 200，且 KV 落库新版本", async () => {
		stubGithubLogin("gaubee");
		const { env, kv } = envWithRules(VALID_RULES);
		const res = await app.request(
			putRequest("203.0.113.106", { ...VALID_RULES, version: 4 }),
			undefined,
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 4 });
		expect(JSON.parse(kv.store.get(GEO_RULES_KV_KEY) as string).version).toBe(4);
	});

	it("KV 损坏（回退默认）→ 视同首次写入，正整数即可", async () => {
		stubGithubLogin("gaubee");
		const kv = new MemKV();
		kv.store.set(GEO_RULES_KV_KEY, "{broken json");
		const res = await app.request(
			putRequest("203.0.113.107", { ...VALID_RULES, version: 2 }),
			undefined,
			baseEnv({ GEO_RULES: kv }),
		);
		expect(res.status).toBe(200);
	});

	it("写审计行带 cfCountry（r9 P1-4）", async () => {
		stubGithubLogin("gaubee");
		const logs: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(String(args[0]));
		});
		try {
			const res = await app.request(
				putRequest("203.0.113.108", { ...VALID_RULES, version: 3 }, { country: "JP" }),
				undefined,
				baseEnv({ GEO_RULES: new MemKV() }),
			);
			expect(res.status).toBe(200);
			const writeLine = logs.find((l) => l.includes('"audit":"geo_rules.write"'));
			expect(writeLine).toBeTruthy();
			expect(JSON.parse(writeLine as string).cfCountry).toBe("JP");
		} finally {
			spy.mockRestore();
		}
	});
});
