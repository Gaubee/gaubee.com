/**
 * worker 单测（cdn-media-bootstrap Phase 2，A6 + r9/r10 复评修复）：
 * - GET /api/geo：默认规则回退（无 DO binding/DO 无状态/无 cf）、country 命中、外部 base 返回、
 *   响应头 private, no-store（r9 P1-1：地区结果禁入共享缓存）。
 * - GET|PUT /api/geo/rules：owner 鉴权（401 无 token / 401 坏 token / 403 非 owner /
 *   403 OWNER_LOGIN 未配置 fail-closed）、owner 写 200 + DO 落库回读、schema 非法 400、
 *   DO binding 缺失 500、限流 429、版本服务端单调（重复/回退/跳跃 409 带 currentVersion，
 *   严格 +1 200，首写正整数）、写审计行带 cfCountry。
 * - 并发线性化（r10 P1-1）：Promise.all 两个 version+1 的 PUT → 恰一 200 一 409，
 *   且 409 报告的是胜者已提交的版本（CAS 原子：后到者判定必见先到者落定，无分叉无丢失更新），
 *   最终规则文档唯一胜者。版本判定在 GeoRulesDO 串行执行，worker 只透传。
 * HTTP 层用 Hono app.request() 真实分发；GeoRulesDO 用内存 storage 替身 + MemDONamespace
 * （idFromName/get/fetch 结构面，单实例寻址语义）；GitHub /user 用 fetch stub。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GEO_RULES, type GeoRules } from "../../src/lib/geo/contract";
import { GeoRulesDO } from "./geo-rules-do";
import type { Env } from "./env";
import app from "./index";

/** 内存 storage + blockConcurrencyWhile 直通的 DurableObjectState 测试替身（同 geo-rules-do.test）。 */
function makeState(map: Map<string, unknown>): DurableObjectState {
	const storage = {
		get: async <T>(key: string): Promise<T | undefined> => map.get(key) as T | undefined,
		put: async (key: string, value: unknown): Promise<void> => {
			map.set(key, value);
		},
		delete: async (key: string): Promise<boolean> => map.delete(key),
		deleteAll: async (): Promise<void> => {
			map.clear();
		},
	};
	return {
		storage,
		blockConcurrencyWhile: (fn: () => Promise<void>): Promise<void> => fn(),
	} as unknown as DurableObjectState;
}

/**
 * 内存 DO namespace：idFromName → get 返回指向同一 GeoRulesDO 单例的 stub，
 * 模拟 workerd 的「单实例寻址 + 跨请求同一对象」语义（每个 namespace 独立 storage）。
 */
class MemDONamespace {
	private map = new Map<string, unknown>();
	private instance: GeoRulesDO | null = null;

	idFromName(name: string): { name: string } {
		return { name };
	}

	get(_id: { name: string }): { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } {
		if (!this.instance) this.instance = new GeoRulesDO(makeState(this.map), null);
		const instance = this.instance;
		return {
			fetch: (input, init) => instance.fetch(new Request(input, init)),
		};
	}

	/** 种入规则文档（走 DO 自身 PUT：空实例首写语义，接受任意正整数版本）。 */
	async seed(rules: GeoRules): Promise<void> {
		const res = await this.get(this.idFromName("geo-rules")).fetch("https://geo-rules.do/state", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(rules),
		});
		if (res.status !== 200) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
	}

	asNamespace(): DurableObjectNamespace {
		return this as unknown as DurableObjectNamespace;
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
	it("默认规则回退：无 DO binding → 同源 + version 0（A8）", async () => {
		const res = await app.request(geoRequest({ country: "CN", continent: "AS" }), undefined, baseEnv());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ mediaBase: "", ruleVersion: 0 });
	});

	it("默认规则回退：DO 无状态 → 同源", async () => {
		const env = baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() });
		const res = await app.request(geoRequest({ country: "CN" }), undefined, env);
		expect(await res.json()).toEqual({ mediaBase: "", ruleVersion: 0 });
	});

	it("country 命中：CN → 外部 base；US → default 同源；返回 ruleVersion", async () => {
		const ns = new MemDONamespace();
		await ns.seed(VALID_RULES);
		const env = baseEnv({ GEO_RULES_DO: ns.asNamespace() });

		const cn = await app.request(geoRequest({ country: "CN", continent: "AS" }), undefined, env);
		expect(cn.status).toBe(200);
		expect(await cn.json()).toEqual({ mediaBase: "https://esa.example.com", ruleVersion: 3 });

		const us = await app.request(geoRequest({ country: "US", continent: "NA" }), undefined, env);
		expect(await us.json()).toEqual({ mediaBase: "", ruleVersion: 3 });
	});

	it("无 cf（本地 wrangler dev 常态）→ 跳过地区条件，落 default 规则", async () => {
		const ns = new MemDONamespace();
		await ns.seed(VALID_RULES);
		const res = await app.request(geoRequest(), undefined, baseEnv({ GEO_RULES_DO: ns.asNamespace() }));
		expect(await res.json()).toEqual({ mediaBase: "", ruleVersion: 3 });
		expect(DEFAULT_GEO_RULES.version).toBe(0);
	});

	it("响应头 private, no-store（r9 P1-1：地区结果禁入共享缓存，CF 默认 cache key 不含 country）", async () => {
		const res = await app.request(geoRequest({ country: "CN" }), undefined, baseEnv());
		expect(res.headers.get("cache-control")).toBe("private, no-store");
	});
});

describe("GET /api/geo/rules（owner 读）", () => {
	it("owner 读：DO 无状态时回显默认规则 + fromDefault 标记", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			"/api/geo/rules",
			{ headers: { Authorization: "Bearer tok" } },
			baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rules: DEFAULT_GEO_RULES, fromDefault: true });
	});

	it("owner 读：已有规则 → 原样回显 + fromDefault=false", async () => {
		stubGithubLogin("gaubee");
		const ns = new MemDONamespace();
		await ns.seed(VALID_RULES);
		const res = await app.request(
			"/api/geo/rules",
			{ headers: { Authorization: "Bearer tok" } },
			baseEnv({ GEO_RULES_DO: ns.asNamespace() }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rules: VALID_RULES, fromDefault: false });
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

	it("owner 写 → 200，login 大小写不敏感，且 DO 落库可回读", async () => {
		stubGithubLogin("Gaubee");
		const ns = new MemDONamespace();
		const env = baseEnv({ GEO_RULES_DO: ns.asNamespace() });
		const res = await app.request("/api/geo/rules", putInit("tok"), env);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 3 });

		// owner 读回显原始规则
		const rulesRes = await app.request(
			"/api/geo/rules",
			{ headers: { Authorization: "Bearer tok" } },
			env,
		);
		expect(await rulesRes.json()).toEqual({ rules: VALID_RULES, fromDefault: false });

		// 写入后 /api/geo 立即反映新规则
		const geo = await app.request(geoRequest({ country: "CN" }), undefined, env);
		expect(await geo.json()).toEqual({ mediaBase: "https://esa.example.com", ruleVersion: 3 });
	});

	it("schema 非法 → 400（version 类型错误）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			"/api/geo/rules",
			putInit("tok", { version: "x", rules: [] }),
			baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() }),
		);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error?: string };
		expect(data.error).toContain("version");
	});

	it("DO binding 缺失 → 500（fail-fast 提示配置，不静默丢写）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request("/api/geo/rules", putInit("tok"), baseEnv());
		expect(res.status).toBe(500);
		const data = (await res.json()) as { error?: string };
		expect(data.error).toContain("GEO_RULES_DO");
	});

	it("限流：同 IP 超过写窗口上限 → 429（独立 IP 桶，放最后防串扰）", async () => {
		stubGithubLogin("gaubee");
		const ip = "203.0.113.9";
		const env = baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() });
		let last = 200;
		for (let i = 0; i < 21; i++) {
			const res = await app.request(
				"/api/geo/rules",
				{ ...putInit("tok"), headers: { ...putInit("tok").headers, "CF-Connecting-IP": ip } },
				env,
			);
			last = res.status;
			if (res.status === 429) break;
		}
		expect(last).toBe(429);
	});
});

describe("PUT /api/geo/rules 版本服务端单调（r9 P1-2，r10 起由 GeoRulesDO 串行守护）", () => {
	/** 预置 DO 已有 rules 的 env（走 DO 自身 PUT 首写语义）。 */
	async function envWithRules(rules: GeoRules): Promise<Env> {
		const ns = new MemDONamespace();
		await ns.seed(rules);
		return baseEnv({ GEO_RULES_DO: ns.asNamespace() });
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

	it("首次写入（DO 无状态）→ 任意正整数 version 接受", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.101", { ...VALID_RULES, version: 5 }),
			undefined,
			baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 5 });
	});

	it("首次写入 version 0 → 400（与内置默认规则 v0 撞代次，拒收）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.102", { ...VALID_RULES, version: 0 }),
			undefined,
			baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() }),
		);
		expect(res.status).toBe(400);
	});

	it("同 version 重复写 → 409，响应带 currentVersion（worker 原样透传 DO 语义）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.103", VALID_RULES),
			undefined,
			await envWithRules(VALID_RULES),
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: "version conflict: current 3, expected 4",
			currentVersion: 3,
		});
	});

	it("版本回退 → 409", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.104", { ...VALID_RULES, version: 2 }),
			undefined,
			await envWithRules(VALID_RULES),
		);
		expect(res.status).toBe(409);
	});

	it("版本跳跃（+2）→ 409（严格 +1）", async () => {
		stubGithubLogin("gaubee");
		const res = await app.request(
			putRequest("203.0.113.105", { ...VALID_RULES, version: 5 }),
			undefined,
			await envWithRules(VALID_RULES),
		);
		expect(res.status).toBe(409);
	});

	it("严格 +1 → 200，且 /api/geo 立即反映新版本", async () => {
		stubGithubLogin("gaubee");
		const env = await envWithRules(VALID_RULES);
		const res = await app.request(putRequest("203.0.113.106", { ...VALID_RULES, version: 4 }), undefined, env);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ruleVersion: 4 });
		const geo = await app.request(geoRequest({ country: "CN" }), undefined, env);
		expect(await geo.json()).toEqual({ mediaBase: "https://esa.example.com", ruleVersion: 4 });
	});

	it("并发两个 version+1 PUT → 恰一 200 一 409，最终规则文档唯一胜者（r10 P1-1）", async () => {
		stubGithubLogin("gaubee");
		const env = await envWithRules(VALID_RULES);
		const a: GeoRules = {
			version: 4,
			rules: [{ match: { countries: ["CN"] }, mediaBase: "https://a.example.com" }],
		};
		const b: GeoRules = {
			version: 4,
			rules: [{ match: { countries: ["JP"] }, mediaBase: "https://b.example.com" }],
		};
		const ip = "203.0.113.201";
		const [ra, rb] = await Promise.all([
			app.request(putRequest(ip, a), undefined, env),
			app.request(putRequest(ip, b), undefined, env),
		]);
		expect([ra.status, rb.status].sort()).toEqual([200, 409]);

		// 409 必然报告胜者已提交的 v4（CAS 原子：后到者的版本判定必见先到者的内存落定）——
		// 若见到 v3 则意味着判定与写入可被插入，正是 r10 P1-1 要消灭的丢失更新窗口
		const winner = ra.status === 200 ? a : b;
		const loser = ra.status === 409 ? ra : rb;
		expect(await loser.json()).toEqual({
			error: "version conflict: current 4, expected 5",
			currentVersion: 4,
		});

		// 最终文档只有一个确定胜者：owner 读回的规则逐字段等于 200 那个请求的 body
		const rulesRes = await app.request(
			"/api/geo/rules",
			{ headers: { Authorization: "Bearer tok", "CF-Connecting-IP": "203.0.113.202" } },
			env,
		);
		expect(((await rulesRes.json()) as { rules: GeoRules }).rules).toEqual(winner);
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
				baseEnv({ GEO_RULES_DO: new MemDONamespace().asNamespace() }),
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
