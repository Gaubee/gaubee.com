/**
 * Gaubee Service Worker —— SSG 阅读站加速 + SPA 首屏主题态注入。
 *
 * 范围：
 * 1. /pages 开头的 GET（HTML/JS/CSS/字体/图片）：stale-while-revalidate（先返回缓存，后台更新）。
 *    跳过 /pages/raw/*（原始 markdown 总取最新）。
 * 2. SPA navigation 请求（Accept: text/html，非 /pages）：网络优先 + 主题态注入。
 *    在返回的 HTML <head> 末尾注入 <style>--primary-h</style>，杜绝刷新主题闪烁（增强）。
 *
 * 主题持久化：client postMessage({type:"THEME_HUE",hue}) 通知 SW，
 * SW 存入 Cache Storage 特殊 key，fetch 时读取注入。
 * SW 不存在时（dev）走 JS 注入路径，完全向后兼容。
 *
 * 注册：见 src/lib/sw/register.ts，仅在 production + browser 注册（dev 下避免破坏 HMR）。
 */

const CACHE_VERSION = "gaubee-sw-v6";
const CACHE_KEY = `gaubee-cache-${CACHE_VERSION}`;
/**
 * 主题色相持久化的特殊 cache key。
 * 必须是合法 URL 路径（Cache.put 会解析为 Request），用 / 开头避免协议解析错误。
 * 用特殊前缀 __sw__/ 避免与真实路由冲突。
 */
const THEME_CACHE_KEY = "/__sw__/theme-hue";

// 预缓存的核心 SSG 入口（install 时主动拉取，保证首次离线可用）
const PRECACHE_URLS = ["/pages", "/pages/archive"];

/** 是否应该 SSG 缓存该请求（/pages 范围）。 */
function shouldSsgCache(request, url) {
  if (request.method !== "GET") return false;
  const p = url.pathname;
  if (p !== "/pages" && !p.startsWith("/pages/")) return false;
  if (p.startsWith("/pages/raw/")) return false;
  return true;
}

/** 是否是 SPA navigation 请求（HTML 文档，非 /pages）。 */
function isSpaNavigation(request, url) {
  if (request.method !== "GET") return false;
  if (url.pathname === "/pages" || url.pathname.startsWith("/pages/")) return false;
  // navigation 请求的 Accept 头含 text/html
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

// install：预缓存核心入口 + 立即激活
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_KEY);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url);
            if (res.ok) await cache.put(url, res);
          } catch {
            // 忽略
          }
        }),
      );
      self.skipWaiting();
    })(),
  );
});

// activate：清理旧版本缓存，立即接管
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_KEY).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// fetch：按请求类型分发
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  if (shouldSsgCache(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (isSpaNavigation(request, url)) {
    event.respondWith(spaNavigationWithTheme(request));
  }
});

/**
 * SPA navigation：网络优先，拿到 HTML 后注入当前主题色相（双旋钮）。
 * 注入 <style>:root{--primary-h:X;--base-h:Y}</style> 到 </head> 前，首屏即带主题态。
 */
async function spaNavigationWithTheme(request) {
  try {
    const response = await fetch(request);
    if (!response.ok) return response;

    const theme = await readThemeHue();
    if (theme === null) return response; // 无主题态，原样返回

    // 注入主题色 inline style 到 HTML（primary-h + base-h 双旋钮）
    const html = await response.text();
    const rules = [];
    if (typeof theme.hue === "number") rules.push(`--primary-h:${theme.hue}`);
    if (typeof theme.baseHue === "number") rules.push(`--base-h:${theme.baseHue}`);
    if (rules.length === 0) return response;
    const injected = html.replace(
      "</head>",
      `<style id="sw-theme">:root{${rules.join(";")}}</style></head>`,
    );

    return new Response(injected, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    // 网络失败：无兜底（SPA 入口无法离线，交给浏览器默认错误页）
    return new Response("网络不可用", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Stale-While-Revalidate（/pages SSG）：
 * 1. 缓存命中 → 立即返回缓存 + 后台拉新更新缓存
 * 2. 缓存未命中 → 拉取网络，成功则缓存
 * 3. 网络失败 → 回退到缓存（任意 /pages 缓存，作离线兜底）
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_KEY);
  const cached = await cache.match(request);

  const fetchAndUpdate = async () => {
    try {
      const response = await fetch(request);
      if (response.ok || response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return undefined;
    }
  };

  if (cached) {
    fetchAndUpdate();
    return cached;
  }

  const networkResponse = await fetchAndUpdate();
  if (networkResponse) return networkResponse;

  const fallback = await cache.match("/pages");
  if (fallback) return fallback;

  return new Response("离线且无缓存", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ---- 主题色相持久化（Cache Storage）----

/** 读取持久化的主题色相 {hue, baseHue}。SW 重启后从 Cache 恢复。 */
async function readThemeHue() {
  const cache = await caches.open(CACHE_KEY);
  const res = await cache.match(THEME_CACHE_KEY);
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 持久化主题色相到 Cache Storage。存 {hue, baseHue} 对象。 */
async function writeThemeHue(theme) {
  const cache = await caches.open(CACHE_KEY);
  const res = new Response(JSON.stringify(theme), {
    headers: { "Content-Type": "application/json" },
  });
  await cache.put(THEME_CACHE_KEY, res);
}

// message：接收 client 的主题更新通知 + SKIP_WAITING
self.addEventListener("message", async (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data?.type === "THEME_HUE") {
    // 持久化主题色 {hue, baseHue} 到 Cache Storage，下次 navigation 时注入。
    const theme = {
      hue: typeof data.hue === "number" ? data.hue : undefined,
      baseHue: typeof data.baseHue === "number" ? data.baseHue : undefined,
    };
    try {
      await writeThemeHue(theme);
      if (event.source) {
        event.source.postMessage({ type: "THEME_HUE_ACK", ...theme });
      }
    } catch (err) {
      console.error("[SW] themeHue 持久化失败:", err);
    }
  }
});
