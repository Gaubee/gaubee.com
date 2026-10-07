/**
 * media-src.ts — cdn-media 引用地区路由重写（Svelte action，零依赖 vanilla DOM）。
 *
 * 正交意图：
 * - [2026-10-07] cdn-media-bootstrap Phase 2（openspec R1/R5，A8 默认同源）：
 *   把容器内 `[src^="/cdn-media/"]`（img/video/audio/source）、`[poster^="/cdn-media/"]`、
 *   `a[href^="/cdn-media/"]` 四类引用重写为 `mediaBase + path`。
 * - base 来源：同源 fetch `/api/geo`（timeout 1.5s，任何失败/超时/无规则 → 不重写，
 *   保持相对路径——static-server 内建 cdn-base，同源原生可用）。
 * - 缓存：模块级单例（多挂载点共享一次 fetch）+ sessionStorage（key 含规则版本，TTL 10min；
 *   geo 失败只在内存负缓存 30s，不进 sessionStorage）。
 * - 幂等：重写后 URL 不再以 `/cdn-media/` 开头，天然不会二次处理；空 base 不触碰 DOM。
 * - 用法：`use:mediasrc` 挂在内容容器上（与 use:xvideo/use:xhighlight 并列），
 *   MarkdownViewer 异步注入的 HTML 由 MutationObserver 兜住（同 x-video 既有模式）。
 */
import { joinMediaBase } from "$lib/geo/contract";

/** geo 成功结果的 sessionStorage TTL（10 分钟）。 */
const GEO_TTL_MS = 10 * 60 * 1000;
/** geo 失败的内存负缓存（30 秒内不重试，防 MO 高频触发打出请求风暴）。 */
const GEO_NEG_TTL_MS = 30 * 1000;
const GEO_TIMEOUT_MS = 1500;

/** sessionStorage 指针 key（指向当前版本条目）；条目 key 含规则版本。 */
const HEAD_KEY = "media-src:geo:head";

/** 四类引用的统一选择器：[src] 覆盖 img/video/audio/source；poster；a[href]。 */
const MEDIA_SELECTOR =
	'[src^="/cdn-media/"], [poster^="/cdn-media/"], a[href^="/cdn-media/"]';

interface GeoCacheHead {
	v: number;
	exp: number;
}

/** /api/geo 的响应载荷（与 worker GET /api/geo 契约一致）。 */
interface GeoPayload {
	mediaBase: string;
	ruleVersion: number;
}

/** 模块级缓存（所有挂载点共享）：undefined=未拉取，null=拉取失败，""=同源。 */
let cachedBase: string | null | undefined;
let cachedAt = 0;
let inflight: Promise<string | null> | null = null;

/** 读取 sessionStorage 缓存（head 指针 + 按版本分条的条目）。 */
function readSessionCache(now: number): string | null {
	try {
		const headRaw = sessionStorage.getItem(HEAD_KEY);
		if (!headRaw) return null;
		const head = JSON.parse(headRaw) as Partial<GeoCacheHead>;
		if (typeof head.v !== "number" || typeof head.exp !== "number" || head.exp < now) return null;
		const entryRaw = sessionStorage.getItem(`media-src:geo:v${head.v}`);
		if (!entryRaw) return null;
		const entry = JSON.parse(entryRaw) as { mediaBase?: unknown; exp?: number };
		if (typeof entry.mediaBase !== "string" || typeof entry.exp !== "number" || entry.exp < now) {
			return null;
		}
		return entry.mediaBase;
	} catch {
		return null; // 无痕模式 / 环境无 sessionStorage / 损坏数据
	}
}

function writeSessionCache(mediaBase: string, ruleVersion: number): void {
	try {
		const exp = Date.now() + GEO_TTL_MS;
		sessionStorage.setItem(`media-src:geo:v${ruleVersion}`, JSON.stringify({ mediaBase, exp }));
		sessionStorage.setItem(HEAD_KEY, JSON.stringify({ v: ruleVersion, exp } satisfies GeoCacheHead));
	} catch {
		/* 无痕模式忽略 */
	}
}

function isGeoPayload(v: unknown): v is GeoPayload {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as { mediaBase?: unknown }).mediaBase === "string" &&
		typeof (v as { ruleVersion?: unknown }).ruleVersion === "number"
	);
}

/** fetch /api/geo：任何失败（网络/超时/非 2xx/载荷非法）→ null。 */
async function fetchGeo(): Promise<GeoPayload | null> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
		try {
			const resp = await fetch("/api/geo", { signal: ctrl.signal });
			if (!resp.ok) return null;
			const data: unknown = await resp.json();
			return isGeoPayload(data) ? data : null;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return null;
	}
}

/**
 * 取当前访客的 mediaBase：""（同源，不重写）或外部 origin；null = geo 不可用（不重写）。
 * 成功结果进 sessionStorage（key 含规则版本，TTL 10min）；失败只负缓存在内存（30s 后允许重试）。
 */
export function getGeoMediaBase(): Promise<string | null> {
	const now = Date.now();
	if (cachedBase !== undefined) {
		const ttl = cachedBase === null ? GEO_NEG_TTL_MS : GEO_TTL_MS;
		if (now - cachedAt < ttl) return Promise.resolve(cachedBase);
	}
	const session = readSessionCache(now);
	if (session !== null) {
		cachedBase = session;
		cachedAt = now;
		return Promise.resolve(session);
	}
	if (!inflight) {
		inflight = fetchGeo()
			.then((payload) => {
				cachedBase = payload?.mediaBase ?? null;
				cachedAt = Date.now();
				if (payload) writeSessionCache(payload.mediaBase, payload.ruleVersion);
				return cachedBase;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

/** 对容器内四类引用做一次重写（幂等：重写后不再匹配选择器）。 */
function rewriteWithin(root: HTMLElement, base: string): void {
	const rewriteAttr = (el: Element, attr: string): void => {
		const value = el.getAttribute(attr);
		if (value && value.startsWith("/cdn-media/")) {
			el.setAttribute(attr, joinMediaBase(base, value));
		}
	};
	for (const el of root.querySelectorAll<HTMLElement>(MEDIA_SELECTOR)) {
		rewriteAttr(el, "src");
		rewriteAttr(el, "poster");
		if (el instanceof HTMLAnchorElement) rewriteAttr(el, "href");
	}
}

/**
 * cdn-media 引用地区路由 action。geo 失败/超时/空 base 一律保持 SSG 相对路径（A8）。
 */
export function mediasrc(node: HTMLElement): { destroy: () => void } {
	let alive = true;
	const apply = (): void => {
		void getGeoMediaBase().then((base) => {
			if (alive && base) rewriteWithin(node, base);
		});
	};

	// 首扫（SSG HTML 此刻就可能有引用；空 base/失败时不触碰 DOM）
	apply();
	// MarkdownViewer 在 $effect 里注入 HTML → 用 MutationObserver 等它们出现后再重写
	const mo = new MutationObserver(apply);
	mo.observe(node, { childList: true, subtree: true });

	return {
		destroy() {
			alive = false;
			mo.disconnect();
		},
	};
}
