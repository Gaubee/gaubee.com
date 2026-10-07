/**
 * geo 地区路由（cdn-media-bootstrap Phase 2，openspec R5 / 契约 A6）。
 *
 * 正交意图：
 * - [2026-10-07] GET /api/geo：公读。地区来源 request.cf（CF 免费自带），规则读
 *   GeoRulesDO（单实例 Durable Object，裁决：直接经 DO 读），DO 缺失/不可达/无状态/损坏
 *   → 内置默认规则（mediaBase="" 同源，A8）。响应 { mediaBase, ruleVersion }。
 * - GET /api/geo/rules：owner 读原始规则文档（后台配置页回显用）。
 * - PUT /api/geo/rules：owner 写。Bearer GitHub token → /user → login 与 OWNER_LOGIN 匹配；
 *   schema 校验（src/lib/geo/contract.ts 三方共用）后转发 GeoRulesDO；内存桶限流 + 结构化审计。
 * - [2026-10-07 r10 P1-1] 规则存储从 KV 迁到 Durable Object 单写入器（worker/src/geo-rules-do.ts）：
 *   KV 无 compare-and-swap，「读→比较→写」在并发 owner PUT 下可双双 200 后写覆盖。
 *   版本单调判定整体下沉进 DO，本文件不再做任何版本比较，只透传 200/409/400；
 *   KV 读写路径与 GEO_RULES KV binding 一并删除。
 * - 妥协声明：限流桶在内存（isolate 重启即清零），是「简单限流」契约的有意取舍；
 *   精确全局限流需要独立的限流 DO，当前规模不值得。
 * - [2026-10-07 r9 复评] GET /api/geo 响应 private, no-store（地区结果禁入任何共享缓存：
 *   CF 默认 cache key 不含 country，共享缓存会让先到地区决定全网 mediaBase）；
 *   写审计行带 cfCountry。
 */
import { Hono, type Context } from "hono";

import {
	DEFAULT_GEO_RULES,
	resolveGeoBase,
	validateGeoRules,
	type GeoRules,
} from "../../src/lib/geo/contract";
import type { Env } from "./env";

/** 限流：每 IP 每窗口次数（GET 宽、写严）。 */
const RATE_GET = 120;
const RATE_WRITE = 20;
const RATE_WINDOW_MS = 60_000;
/** GitHub /user 校验超时。 */
const GITHUB_TIMEOUT_MS = 5000;

/** GeoRulesDO 单实例的固定名与 RPC 地址（idFromName 全网同一实例）。 */
const DO_NAME = "geo-rules";
const DO_STATE_URL = "https://geo-rules.do/state";

type GeoContext = Context<{ Bindings: Env }>;

const buckets = new Map<string, { count: number; resetAt: number }>();

/** 内存桶限流：key 命中窗口内计数；窗口过期重置。Map 超万条整体清空（防 IP 爆内存）。 */
function rateAllow(key: string, limit: number): boolean {
	const now = Date.now();
	if (buckets.size > 10_000) buckets.clear();
	const b = buckets.get(key);
	if (!b || b.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return true;
	}
	if (b.count >= limit) return false;
	b.count += 1;
	return true;
}

/** 结构化审计行（console.log → `wrangler tail` 可见）。 */
function audit(event: string, fields: Record<string, unknown>): void {
	console.log(JSON.stringify({ audit: event, at: new Date().toISOString(), ...fields }));
}

/** CF 边缘注入的地理位置（wrangler dev 本地通常缺失 → 走 default 规则）。 */
function cfGeo(c: GeoContext): { country?: string; continent?: string } {
	const cf = (c.req.raw as Request & { cf?: { country?: unknown; continent?: unknown } }).cf;
	const country = typeof cf?.country === "string" ? cf.country : undefined;
	const continent = typeof cf?.continent === "string" ? cf.continent : undefined;
	return { country, continent };
}

/** GeoRulesDO 单实例 stub（binding 缺失 → null，由调用方走 fail-safe 路径）。 */
function geoRulesStub(env: Env): DurableObjectStub | null {
	const ns = env.GEO_RULES_DO;
	if (!ns) return null;
	return ns.get(ns.idFromName(DO_NAME));
}

/** 读规则文档 + fromDefault 标记：DO 缺失/不可达/无状态/损坏 → 内置默认（A8 fail-safe，绝不 500）。 */
async function loadGeoRulesWithOrigin(env: Env): Promise<{ rules: GeoRules; fromDefault: boolean }> {
	const stub = geoRulesStub(env);
	if (!stub) return { rules: DEFAULT_GEO_RULES, fromDefault: true };
	try {
		const res = await stub.fetch(DO_STATE_URL);
		if (res.status === 404) return { rules: DEFAULT_GEO_RULES, fromDefault: true };
		if (!res.ok) {
			audit("geo_rules.do_error", { action: "read", status: res.status });
			return { rules: DEFAULT_GEO_RULES, fromDefault: true };
		}
		const parsed = validateGeoRules(await res.json());
		if (!parsed.ok) {
			audit("geo_rules.do_corrupt", { error: parsed.error });
			return { rules: DEFAULT_GEO_RULES, fromDefault: true };
		}
		return { rules: parsed.value, fromDefault: false };
	} catch (e) {
		audit("geo_rules.do_error", { action: "read", error: e instanceof Error ? e.message : String(e) });
		return { rules: DEFAULT_GEO_RULES, fromDefault: true };
	}
}

/** Bearer token → GitHub login（token 无效/网络失败 → null）。 */
async function githubLogin(token: string): Promise<string | null> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), GITHUB_TIMEOUT_MS);
		try {
			const resp = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "gaubee-auth-worker",
				},
				signal: ctrl.signal,
			});
			if (!resp.ok) return null;
			const data = (await resp.json()) as { login?: unknown };
			return typeof data.login === "string" ? data.login : null;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return null;
	}
}

interface OwnerAuthOk {
	ok: true;
	login: string;
}
interface OwnerAuthFailed {
	ok: false;
	response: Response;
}

/** owner 鉴权：Bearer GitHub token → /user → login 与 OWNER_LOGIN 匹配（大小写不敏感）。 */
async function requireOwner(c: GeoContext, action: "read" | "write"): Promise<OwnerAuthOk | OwnerAuthFailed> {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	const auth = c.req.header("Authorization") ?? "";
	const token = auth.replace(/^Bearer\s+/i, "");
	if (!token) {
		return { ok: false, response: c.json({ error: "unauthorized: bearer github token required" }, 401) };
	}
	const login = await githubLogin(token);
	if (!login) {
		audit("geo_rules.denied", { action, ip, reason: "invalid_github_token" });
		return { ok: false, response: c.json({ error: "unauthorized: github token invalid" }, 401) };
	}
	const owner = c.env.OWNER_LOGIN;
	if (!owner || login.toLowerCase() !== owner.toLowerCase()) {
		audit("geo_rules.denied", { action, ip, login, reason: owner ? "not_owner" : "owner_unconfigured" });
		return { ok: false, response: c.json({ error: "forbidden: owner only" }, 403) };
	}
	return { ok: true, login };
}

export const geoRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/geo —— 公读，按访客地区解析 mediaBase。
 * 响应头 private, no-store（r9 P1-1）：结果按 request.cf.country/continent 变化，而 CF 默认
 * cache key 不含 country——任何共享缓存（CF 边缘/反代）都会让先到地区决定同一 URL 的
 * mediaBase，串给所有地区。时效由前端 sessionStorage TTL + 保存时的 BroadcastChannel
 * 失效广播承担；未来若要恢复共享缓存，必须把规范化 country 纳入 cache key 并做跨地区验收。
 * 规则来源（r10 P1-1）：直接经 GeoRulesDO 读（单实例内存态，写后立即可见）。
 */
geoRoutes.get("/", async (c) => {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	if (!rateAllow(`get:${ip}`, RATE_GET)) {
		return c.json({ error: "rate limited" }, 429);
	}
	const { rules } = await loadGeoRulesWithOrigin(c.env);
	const { country, continent } = cfGeo(c);
	const result = resolveGeoBase(rules, country, continent);
	return c.json(result, 200, { "Cache-Control": "private, no-store" });
});

/** GET /api/geo/rules —— owner 读原始规则（含 DO 无状态/缺失时的默认规则回显）。 */
geoRoutes.get("/rules", async (c) => {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	if (!rateAllow(`get_rules:${ip}`, RATE_WRITE)) {
		return c.json({ error: "rate limited" }, 429);
	}
	const auth = await requireOwner(c, "read");
	if (!auth.ok) return auth.response;

	const { rules, fromDefault } = await loadGeoRulesWithOrigin(c.env);
	return c.json({ rules, fromDefault });
});

/** PUT /api/geo/rules —— owner 写（schema 校验后转发 GeoRulesDO；版本单调由 DO 串行守护）。 */
geoRoutes.put("/rules", async (c) => {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	if (!rateAllow(`put_rules:${ip}`, RATE_WRITE)) {
		return c.json({ error: "rate limited" }, 429);
	}
	const auth = await requireOwner(c, "write");
	if (!auth.ok) return auth.response;

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "invalid: body must be json" }, 400);
	}
	const parsed = validateGeoRules(body);
	if (!parsed.ok) {
		return c.json({ error: `invalid: ${parsed.error}` }, 400);
	}
	const stub = geoRulesStub(c.env);
	if (!stub) {
		audit("geo_rules.write_failed", { login: auth.login, reason: "do_binding_missing" });
		return c.json({ error: "GEO_RULES_DO binding missing (check wrangler.toml)" }, 500);
	}
	// 版本服务端单调（r9 P1-2）现由 GeoRulesDO 串行守护（r10 P1-1）：version 是前端缓存 key
	// 的发布代次；DO 内「判定 → 内存落定」同步段 + input gate 保证并发 v+1 恰一胜一。
	// 本处只转发，200/409/400 原样透传；409 带 currentVersion 供后台页提示。
	let res: Response;
	try {
		res = await stub.fetch(DO_STATE_URL, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(parsed.value),
		});
	} catch (e) {
		audit("geo_rules.write_failed", {
			login: auth.login,
			reason: "do_unreachable",
			error: e instanceof Error ? e.message : String(e),
		});
		return c.json({ error: "geo rules storage unavailable" }, 502);
	}
	if (res.status === 409) {
		const conflict = (await res.json()) as { error: string; currentVersion: number };
		audit("geo_rules.write_rejected", {
			ip,
			login: auth.login,
			reason: "version_not_monotonic",
			cfCountry: cfGeo(c).country,
			currentVersion: conflict.currentVersion,
			incomingVersion: parsed.value.version,
		});
		return c.json(conflict, 409);
	}
	if (res.status !== 200) {
		// 防御纵深 400（DO 二次校验拒绝）或存储层故障：状态与错误体原样透传。
		const text = await res.text();
		return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
	}
	const ok = (await res.json()) as { ok: true; ruleVersion: number };
	audit("geo_rules.write", {
		ip,
		login: auth.login,
		ruleVersion: ok.ruleVersion,
		ruleCount: parsed.value.rules.length,
		cfCountry: cfGeo(c).country,
	});
	return c.json(ok, 200);
});
