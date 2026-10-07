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
 * - 失效广播（r9 P1-2）：broadcastGeoInvalidation(version)（BroadcastChannel "cdn-media-geo"）——
 *   GeoRulesView 保存规则成功后调用；本 tab 立即清缓存重拉，其它 tab 经 channel 消息同样处理。
 *   挂载中的 action 收到失效先把已改写属性还原为相对路径，再按新 base 重写
 *   （消除 sessionStorage TTL 内继续用旧 base 的窗口）；飞行中的旧 fetch 结果按失效代次丢弃。
 * - 幂等：重写后 URL 不再以 `/cdn-media/` 开头，天然不会二次处理；空 base 不触碰 DOM。
 * - 用法：`use:mediasrc` 挂在内容容器上（与 use:xvideo/use:xhighlight 并列），
 *   MarkdownViewer 异步注入的 HTML 由 MutationObserver 兜住（同 x-video 既有模式）。
 */
import { joinMediaBase, isValidMediaBase, isValidRuleVersion } from "$lib/geo/contract";

/** geo 成功结果的 sessionStorage TTL（10 分钟）。 */
const GEO_TTL_MS = 10 * 60 * 1000;
/** geo 失败的内存负缓存（30 秒内不重试，防 MO 高频触发打出请求风暴）。 */
const GEO_NEG_TTL_MS = 30 * 1000;
const GEO_TIMEOUT_MS = 1500;

/** sessionStorage 缓存 key 前缀（head 指针 + 按版本分条的条目都在它下面，失效时按前缀全清）。 */
const CACHE_PREFIX = "media-src:geo:";
/** sessionStorage 指针 key（指向当前版本条目）；条目 key 含规则版本。 */
const HEAD_KEY = `${CACHE_PREFIX}head`;

/** 多 tab 失效广播频道（GeoRulesView 保存成功后广播，所有 tab 的 mediasrc action 收到即重拉）。 */
const GEO_CHANNEL = "cdn-media-geo";

/** 失效消息载荷（携带保存时的规则版本号便于排查；清除按前缀全清，版本回退也安全）。 */
interface GeoInvalidationMessage {
	type: "invalidate";
	ruleVersion: number;
}

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
/** 失效代次：每次失效 +1；飞行中的旧 fetch 结果据其丢弃，防旧值在失效后回填缓存。 */
let generation = 0;

/** 读取 sessionStorage 缓存（head 指针 + 按版本分条的条目）。 */
function readSessionCache(now: number): string | null {
	try {
		const headRaw = sessionStorage.getItem(HEAD_KEY);
		if (!headRaw) return null;
		const head = JSON.parse(headRaw) as Partial<GeoCacheHead>;
		if (typeof head.v !== "number" || typeof head.exp !== "number" || head.exp < now) return null;
		const entryRaw = sessionStorage.getItem(`${CACHE_PREFIX}v${head.v}`);
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
		sessionStorage.setItem(`${CACHE_PREFIX}v${ruleVersion}`, JSON.stringify({ mediaBase, exp }));
		sessionStorage.setItem(HEAD_KEY, JSON.stringify({ v: ruleVersion, exp } satisfies GeoCacheHead));
	} catch {
		/* 无痕模式忽略 */
	}
}

// ---- 失效广播（r9 P1-2：规则版本服务端单调 + 保存后多 tab 失效，消除 TTL 内旧 base 窗口）----

type GeoInvalidationListener = () => void;
const invalidationListeners = new Set<GeoInvalidationListener>();
let channel: BroadcastChannel | null = null;

/** 惰性建 channel：onmessage 收到合法失效消息 → 清缓存并通知挂载中的 action 重拉。 */
function ensureChannel(): BroadcastChannel | null {
	if (channel) return channel;
	try {
		channel = new BroadcastChannel(GEO_CHANNEL);
		channel.onmessage = (event: MessageEvent) => {
			const msg = event.data as Partial<GeoInvalidationMessage> | null;
			if (msg?.type === "invalidate" && typeof msg.ruleVersion === "number") {
				invalidateGeoCache(msg.ruleVersion);
			}
		};
	} catch {
		channel = null; // 环境无 BroadcastChannel（老浏览器/非浏览器）→ 退化为单 tab TTL 兜底
	}
	return channel;
}

/** 订阅失效（action 挂载时注册、销毁时解绑）；返回解绑函数。 */
export function onGeoInvalidation(cb: GeoInvalidationListener): () => void {
	invalidationListeners.add(cb);
	ensureChannel();
	return () => {
		invalidationListeners.delete(cb);
	};
}

/** 清 sessionStorage 中本模块全部条目（head + 各版本条目；按前缀全清，版本回退也安全）。 */
function clearSessionCache(): void {
	try {
		const doomed: string[] = [];
		for (let i = 0; i < sessionStorage.length; i++) {
			const k = sessionStorage.key(i);
			if (k && k.startsWith(CACHE_PREFIX)) doomed.push(k);
		}
		for (const k of doomed) sessionStorage.removeItem(k);
	} catch {
		/* 环境无 sessionStorage */
	}
}

/** 失效全部缓存并通知监听者（同 tab 调用立即生效；跨 tab 经 BroadcastChannel 消息触发）。 */
function invalidateGeoCache(ruleVersion: number): void {
	generation += 1;
	cachedBase = undefined;
	cachedAt = 0;
	inflight = null;
	clearSessionCache();
	for (const cb of invalidationListeners) {
		try {
			cb();
		} catch {
			/* 单个监听器异常不影响其它挂载点 */
		}
	}
}

/**
 * 保存 geo 规则成功后调用（GeoRulesView）：本 tab 立即清缓存重拉，
 * 其它 tab 经 BroadcastChannel "cdn-media-geo" 收到失效消息后同样处理。
 */
export function broadcastGeoInvalidation(ruleVersion: number): void {
	invalidateGeoCache(ruleVersion);
	try {
		ensureChannel()?.postMessage({
			type: "invalidate",
			ruleVersion,
		} satisfies GeoInvalidationMessage);
	} catch {
		/* 广播失败不阻塞保存流程（本 tab 已生效，其它 tab 等 TTL） */
	}
}

/**
 * /api/geo 响应严格校验（r9 P1-4 防御性加固，契约 helper 三方共用）：
 * mediaBase 必须是空串或 http(s) origin 形态、ruleVersion 必须是非负整数；非法一律按失败处理
 * （负缓存 30s、不重写 DOM）——被篡改/漂移的响应不能进缓存、更不能被拼进引用 URL。
 */
function isGeoPayload(v: unknown): v is GeoPayload {
	return (
		typeof v === "object" &&
		v !== null &&
		isValidMediaBase((v as { mediaBase?: unknown }).mediaBase) &&
		isValidRuleVersion((v as { ruleVersion?: unknown }).ruleVersion)
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
		const gen = generation;
		inflight = fetchGeo()
			.then((payload) => {
				if (gen !== generation) {
					// 飞行中发生失效：本结果已过期，不得回填缓存 → 转链到失效后的新拉取
					//（旧调用方拿到的也是新鲜 base；多次失效则继续转链，收敛于最新一次）
					return getGeoMediaBase();
				}
				cachedBase = payload?.mediaBase ?? null;
				cachedAt = Date.now();
				if (payload) writeSessionCache(payload.mediaBase, payload.ruleVersion);
				return cachedBase;
			})
			.finally(() => {
				if (gen === generation) inflight = null; // 过代次的旧请求不得清掉新请求的 inflight
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
 * 收到 geo 失效（本 tab 保存广播 / 其它 tab 经 BroadcastChannel）→ 先把已改写属性还原为
 * 相对路径，再按新 base 重拉重写——规则切换后已挂载内容即时收敛，不等 TTL 过期。
 */
export function mediasrc(node: HTMLElement): { destroy: () => void } {
	let alive = true;
	/** 最近一次成功重写使用的 base（收到失效时用它把已改写属性还原为相对路径）。 */
	let appliedBase = "";

	const apply = (): void => {
		void getGeoMediaBase().then((base) => {
			if (alive && base) {
				rewriteWithin(node, base);
				appliedBase = base;
			}
		});
	};

	/**
	 * 失效前置：把已改写为 appliedBase 前缀的属性还原回 /cdn-media/ 相对路径，
	 * 让它们重新命中重写选择器。base 是干净 origin（契约校验），可安全内插选择器；
	 * MO 只盯 childList，这里与 rewriteWithin 的 setAttribute 都不会自触发。
	 */
	const revert = (): void => {
		if (!appliedBase) return;
		const prefix = `${appliedBase}/cdn-media/`;
		const selector = `[src^="${prefix}"], [poster^="${prefix}"], a[href^="${prefix}"]`;
		const revertAttr = (el: Element, attr: string): void => {
			const value = el.getAttribute(attr);
			if (value && value.startsWith(prefix)) {
				el.setAttribute(attr, `/cdn-media/${value.slice(prefix.length)}`);
			}
		};
		for (const el of node.querySelectorAll(selector)) {
			revertAttr(el, "src");
			revertAttr(el, "poster");
			if (el instanceof HTMLAnchorElement) revertAttr(el, "href");
		}
		appliedBase = "";
	};

	// 失效监听：模块已清缓存 → 还原旧改写 → 重拉新 base 重写
	const offInvalidate = onGeoInvalidation(() => {
		if (!alive) return;
		revert();
		apply();
	});

	// 首扫（SSG HTML 此刻就可能有引用；空 base/失败时不触碰 DOM）
	apply();
	// MarkdownViewer 在 $effect 里注入 HTML → 用 MutationObserver 等它们出现后再重写
	const mo = new MutationObserver(apply);
	mo.observe(node, { childList: true, subtree: true });

	return {
		destroy() {
			alive = false;
			mo.disconnect();
			offInvalidate();
		},
	};
}
