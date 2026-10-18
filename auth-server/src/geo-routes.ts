/**
 * geo-routes.ts —— /api/geo 地区路由（worker/src/geo.ts 的自托管移植）。
 *
 * 正交意图：
 * - 路由形状/限流/owner 鉴权/审计与 CF Worker 版逐条对齐（契约同源 src/lib/geo/contract）。
 * - 存储从 GeoRulesDO 换为 auth-server/src/geo-store.ts（文件 CAS，语义对齐原 DO）。
 * - 访客地理：CF 版取 request.cf.country/continent（边缘注入）；源站版两者皆 undefined
 *   → resolveGeoBase 落默认规则分支。未来接入 geoip（openresty geoip2 / X-Geo 头）时
 *   只需扩展 geoOf()，路由层不动。
 * - 响应仍带 Cache-Control: private, no-store：与 CF 版同理由——未来任何反代共享缓存
 *   不得缓存按地区变化的结果（今日源站无地区差异，留语义一致性）。
 */
import { Hono, type Context } from "hono";

import {
	DEFAULT_GEO_RULES,
	resolveGeoBase,
	validateGeoRules,
	type GeoRules,
} from "../../src/lib/geo/contract";
import type { Env } from "./env";
import { GeoRulesStore } from "./geo-store";

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

/** 结构化审计行（stdout → journald 可见）。 */
function audit(event: string, fields: Record<string, unknown>): void {
	console.log(JSON.stringify({ audit: event, at: new Date().toISOString(), ...fields }));
}

/** 反代注入的访客 IP（openresty vhost 设 X-Real-IP；缺失降级 unknown）。 */
function clientIp(c: GeoContext): string {
	return c.req.header("X-Real-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}

/** 访客地理（源站暂无 geoip → 无地区，落默认规则分支；接入点收敛在此）。 */
function geoOf(_c: GeoContext): { country?: string; continent?: string } {
	return { country: undefined, continent: undefined };
}

/** 读规则文档：无状态/损坏 → 内置默认（fail-safe，绝不 500）。 */
function loadGeoRules(store: GeoRulesStore): GeoRules {
	const state = store.getState();
	if (!state) return DEFAULT_GEO_RULES;
	// store 构造时已过 schema；此处防御性再验（文件被手改的运行中场景不存在——态在内存）
	const parsed = validateGeoRules(state);
	return parsed.ok ? parsed.value : DEFAULT_GEO_RULES;
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
					"User-Agent": "gaubee-auth-server",
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
	const ip = clientIp(c);
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

export function createGeoRoutes(store: GeoRulesStore): Hono<{ Bindings: Env }> {
	const geoRoutes = new Hono<{ Bindings: Env }>();

	/**
	 * GET /api/geo —— 公读，解析 mediaBase。响应 private, no-store（语义与 CF 版一致，
	 * 见原文件 r9 注释：按地区变化的结果禁入任何共享缓存）。
	 */
	geoRoutes.get("/", (c) => {
		const ip = clientIp(c);
		if (!rateAllow(`get:${ip}`, RATE_GET)) {
			return c.json({ error: "rate limited" }, 429);
		}
		const rules = loadGeoRules(store);
		const { country, continent } = geoOf(c);
		const result = resolveGeoBase(rules, country, continent);
		return c.json(result, 200, { "Cache-Control": "private, no-store" });
	});

	/** GET /api/geo/rules —— owner 读原始规则（无状态时回显默认规则并带 fromDefault 标记）。 */
	geoRoutes.get("/rules", async (c) => {
		const ip = clientIp(c);
		if (!rateAllow(`get_rules:${ip}`, RATE_WRITE)) {
			return c.json({ error: "rate limited" }, 429);
		}
		const auth = await requireOwner(c, "read");
		if (!auth.ok) return auth.response;

		const hasState = store.hasState();
		const rules = hasState ? loadGeoRules(store) : DEFAULT_GEO_RULES;
		return c.json({ rules, fromDefault: !hasState });
	});

	/** PUT /api/geo/rules —— owner 写（schema 校验后经 store 版本单调落盘；409 带 currentVersion）。 */
	geoRoutes.put("/rules", async (c) => {
		const ip = clientIp(c);
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
		let result;
		try {
			result = store.putState(parsed.value);
		} catch (e) {
			audit("geo_rules.write_failed", {
				login: auth.login,
				reason: "store_unavailable",
				error: e instanceof Error ? e.message : String(e),
			});
			return c.json({ error: "geo rules storage unavailable" }, 502);
		}
		if (!result.ok) {
			if (result.status === 409) {
				audit("geo_rules.write_rejected", {
					ip,
					login: auth.login,
					reason: "version_not_monotonic",
					currentVersion: result.body.currentVersion,
					incomingVersion: parsed.value.version,
				});
			}
			return c.json(result.body, result.status);
		}
		audit("geo_rules.write", {
			ip,
			login: auth.login,
			ruleVersion: result.ruleVersion,
			ruleCount: parsed.value.rules.length,
		});
		return c.json({ ok: true, ruleVersion: result.ruleVersion }, 200);
	});

	return geoRoutes;
}
