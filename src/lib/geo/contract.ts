/**
 * geo 地区路由契约 —— 前端 action / 后台配置页 / worker 三方共用的唯一信源。
 *
 * 正交意图：
 * - [2026-10-07] cdn-media-bootstrap Phase 2（openspec R5）：`/api/geo` 返回 mediaBase
 *   规则的 schema、校验与解析算法。规则存 worker 的 GeoRulesDO（单写入器 Durable Object，
 *   r10 P1-1 起替代 KV），GET /api/geo 公读，写接口 owner 限定。
 * - A8 语义：默认 mediaBase = 空串 = 同源（不重写）；geo 失败/无规则 = 不重写。
 * - 不可拆分原因：契约必须被 worker（Cloudflare Workers）与浏览器同时 import，
 *   本文件保持零运行时依赖、零平台 API（无 DOM/Node/CF 类型），物理上是同一份协议。
 */

/** 规则命中条件：至少声明 countries / continents / default 之一，否则校验失败。 */
export interface GeoRuleMatch {
	/** ISO 3166-1 alpha-2 国家码（大写，如 "CN" "JP"）。 */
	countries?: string[];
	/** 大陆码（大写：AF AN AS EU NA OC SA）。 */
	continents?: string[];
	/** 兜底规则：放最后，前面的规则都不命中时生效。 */
	default?: boolean;
}

/** 单条规则：命中 match → 返回 mediaBase。数组顺序即优先级（先声明先命中）。 */
export interface GeoRule {
	match: GeoRuleMatch;
	/** 空串 = 同源（A8）；非空必须是 http(s) origin（无路径/查询）。 */
	mediaBase: string;
}

/** 规则文档（GeoRulesDO 单文档存储，worker 读写与前端缓存失效广播共用此形状）。 */
export interface GeoRules {
	/** 规则版本号（写接口递增，前端 sessionStorage 缓存 key 携带它）。 */
	version: number;
	rules: GeoRule[];
}

/** GET /api/geo 的响应体。 */
export interface GeoResponse {
	mediaBase: string;
	ruleVersion: number;
}

/** DO 无状态/解析失败/校验失败时的内置规则（A8：全球同源，不重写）。 */
export const DEFAULT_GEO_RULES: GeoRules = {
	version: 0,
	rules: [{ match: { default: true }, mediaBase: "" }],
};

const CONTINENTS = new Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);
/** http(s) origin：scheme://host[:port]，禁止路径/查询/哈希/空白。 */
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;
const COUNTRY_RE = /^[A-Z]{2}$/;
/** 规则条数上限（防手滑写爆 DO 文档/边缓存）。 */
const MAX_RULES = 64;

export type GeoRulesParseResult =
	| { ok: true; value: GeoRules }
	| { ok: false; error: string };

/**
 * mediaBase 约束（r9 P1-4：规则校验与 /api/geo 响应防御校验共用同一判定）：
 * 空串（同源）或 http(s) origin（无路径/查询/空白）。
 */
export function isValidMediaBase(v: unknown): v is string {
	return typeof v === "string" && (v === "" || ORIGIN_RE.test(v));
}

/** ruleVersion 约束：非负整数（前端缓存 key 片段 + 失效广播载荷，必须可作 key）。 */
export function isValidRuleVersion(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * 校验规则文档（手写校验：worker 与浏览器共用，避免为 ~40 行契约引入 zod 到 worker bundle）。
 * 严格模式：未知字段一律拒绝（typos 静默 no-op 比报错更危险）。
 */
export function validateGeoRules(input: unknown): GeoRulesParseResult {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, error: "规则文档必须是对象" };
	}
	const doc = input as Record<string, unknown>;
	const unknownTop = Object.keys(doc).filter((k) => k !== "version" && k !== "rules");
	if (unknownTop.length > 0) {
		return { ok: false, error: `未知字段：${unknownTop.join(", ")}（仅允许 version/rules）` };
	}
	if (!isValidRuleVersion(doc.version)) {
		return { ok: false, error: "version 必须是非负整数" };
	}
	if (!Array.isArray(doc.rules)) {
		return { ok: false, error: "rules 必须是数组" };
	}
	if (doc.rules.length > MAX_RULES) {
		return { ok: false, error: `rules 超过上限（${MAX_RULES}）` };
	}
	const rules: GeoRule[] = [];
	for (let i = 0; i < doc.rules.length; i++) {
		const err = validateRule(doc.rules[i]);
		if (err) return { ok: false, error: `rules[${i}]: ${err}` };
		rules.push(doc.rules[i] as GeoRule);
	}
	return { ok: true, value: { version: doc.version, rules } };
}

function validateRule(input: unknown): string | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return "必须是对象";
	const rule = input as Record<string, unknown>;
	const unknownKeys = Object.keys(rule).filter((k) => k !== "match" && k !== "mediaBase");
	if (unknownKeys.length > 0) return `未知字段：${unknownKeys.join(", ")}（仅允许 match/mediaBase）`;
	if (typeof rule.mediaBase !== "string") return "mediaBase 必须是字符串";
	if (!isValidMediaBase(rule.mediaBase)) {
		return 'mediaBase 必须是空串（同源）或 http(s) origin（如 "https://cdn.example.com"，不带路径）';
	}
	const match = rule.match;
	if (typeof match !== "object" || match === null || Array.isArray(match)) return "match 必须是对象";
	const m = match as Record<string, unknown>;
	const unknownMatch = Object.keys(m).filter(
		(k) => k !== "countries" && k !== "continents" && k !== "default",
	);
	if (unknownMatch.length > 0) {
		return `match 未知字段：${unknownMatch.join(", ")}（仅允许 countries/continents/default）`;
	}
	let hasCondition = false;
	if (m.countries !== undefined) {
		if (!isStringArray(m.countries)) return "match.countries 必须是字符串数组";
		if (m.countries.some((c) => !COUNTRY_RE.test(c))) {
			return "match.countries 必须是两位大写国家码（如 \"CN\"）";
		}
		hasCondition = true;
	}
	if (m.continents !== undefined) {
		if (!isStringArray(m.continents)) return "match.continents 必须是字符串数组";
		if (m.continents.some((c) => !CONTINENTS.has(c))) {
			return 'match.continents 必须是大陆码（AF/AN/AS/EU/NA/OC/SA）';
		}
		hasCondition = true;
	}
	if (m.default !== undefined) {
		if (typeof m.default !== "boolean") return "match.default 必须是布尔值";
		if (m.default) hasCondition = true;
	}
	if (!hasCondition) return "match 不能为空（至少声明 countries/continents/default 之一）";
	return null;
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * 解析访客的 mediaBase：按声明顺序取第一条命中规则；全不命中 → 空串（同源兜底）。
 * country/continent 缺失（本地 dev、无法探测）时跳过对应条件。
 */
export function resolveGeoBase(
	rules: GeoRules,
	country?: string,
	continent?: string,
): GeoResponse {
	const c = country?.toUpperCase();
	const ct = continent?.toUpperCase();
	for (const rule of rules.rules) {
		const m = rule.match;
		const hit =
			m.default === true ||
			(c !== undefined && m.countries?.includes(c) === true) ||
			(ct !== undefined && m.continents?.includes(ct) === true);
		if (hit) return { mediaBase: rule.mediaBase, ruleVersion: rules.version };
	}
	return { mediaBase: "", ruleVersion: rules.version };
}

/** 幂等拼接：base 为空串 → 原样返回（A8 同源）；否则剥 base 尾斜杠后拼 path。 */
export function joinMediaBase(base: string, path: string): string {
	if (base === "") return path;
	return `${base.replace(/\/+$/, "")}${path}`;
}
