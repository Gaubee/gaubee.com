/**
 * geo 地区路由（cdn-media-bootstrap Phase 2，openspec R5 / 契约 A6）。
 *
 * 正交意图：
 * - [2026-10-07] GET /api/geo：公读。地区来源 request.cf（CF 免费自带），规则读 KV，
 *   KV 缺失/损坏 → 内置默认规则（mediaBase="" 同源，A8）。响应 { mediaBase, ruleVersion }。
 * - GET /api/geo/rules：owner 读原始规则文档（后台配置页回显用）。
 * - PUT /api/geo/rules：owner 写。Bearer GitHub token → /user → login 与 OWNER_LOGIN 匹配；
 *   规则 schema 校验（src/lib/geo/contract.ts 三方共用）；内存桶限流 + 结构化审计日志。
 * - 妥协声明：限流桶在内存（isolate 重启即清零），是「简单限流」契约的有意取舍；
 *   精确全局限流需 Durable Object，当前规模不值得。
 */
import { Hono, type Context } from "hono";

import {
	DEFAULT_GEO_RULES,
	GEO_RULES_KV_KEY,
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

/** 读规则文档：KV 无值/解析失败/校验失败 → 内置默认（A8 fail-safe，绝不 500）。 */
async function loadGeoRules(kv: Env["GEO_RULES"]): Promise<{ rules: GeoRules; fromDefault: boolean }> {
	if (!kv) return { rules: DEFAULT_GEO_RULES, fromDefault: true };
	try {
		const raw = await kv.get(GEO_RULES_KV_KEY);
		if (!raw) return { rules: DEFAULT_GEO_RULES, fromDefault: true };
		const parsed = validateGeoRules(JSON.parse(raw));
		if (!parsed.ok) {
			audit("geo_rules.kv_corrupt", { error: parsed.error });
			return { rules: DEFAULT_GEO_RULES, fromDefault: true };
		}
		return { rules: parsed.value, fromDefault: false };
	} catch (e) {
		audit("geo_rules.kv_error", { error: e instanceof Error ? e.message : String(e) });
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

/** GET /api/geo —— 公读，按访客地区解析 mediaBase（短 CDN 缓存，改规则最多 60s 全网生效）。 */
geoRoutes.get("/", async (c) => {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	if (!rateAllow(`get:${ip}`, RATE_GET)) {
		return c.json({ error: "rate limited" }, 429);
	}
	const { rules } = await loadGeoRules(c.env.GEO_RULES);
	const { country, continent } = cfGeo(c);
	const result = resolveGeoBase(rules, country, continent);
	return c.json(result, 200, { "Cache-Control": "public, max-age=60" });
});

/** GET /api/geo/rules —— owner 读原始规则（含 KV 未配置/为空时的默认规则回显）。 */
geoRoutes.get("/rules", async (c) => {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	if (!rateAllow(`get_rules:${ip}`, RATE_WRITE)) {
		return c.json({ error: "rate limited" }, 429);
	}
	const auth = await requireOwner(c, "read");
	if (!auth.ok) return auth.response;

	const { rules, fromDefault } = await loadGeoRules(c.env.GEO_RULES);
	return c.json({ rules, fromDefault });
});

/** PUT /api/geo/rules —— owner 写（schema 校验 + KV 落库 + 审计）。 */
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
	if (!c.env.GEO_RULES) {
		audit("geo_rules.write_failed", { login: auth.login, reason: "kv_binding_missing" });
		return c.json({ error: "GEO_RULES kv binding missing (check wrangler.toml)" }, 500);
	}
	await c.env.GEO_RULES.put(GEO_RULES_KV_KEY, JSON.stringify(parsed.value));
	audit("geo_rules.write", {
		ip,
		login: auth.login,
		ruleVersion: parsed.value.version,
		ruleCount: parsed.value.rules.length,
	});
	return c.json({ ok: true, ruleVersion: parsed.value.version });
});
