/**
 * Gaubee Service Worker —— 仅加速 SSG 阅读站。
 *
 * 范围（与用户确认）：
 * - 只拦截 `/pages` 开头的 GET 请求（HTML/JS/CSS/字体/图片）
 * - 策略：stale-while-revalidate（先返回缓存，后台更新）
 * - 跳过 `/pages/raw/*`（原始 markdown 总取最新）
 * - 其余所有请求（SPA 编辑器、/api/* 代理、登录态等）一律透传，不缓存
 *
 * 注册：见 src/lib/sw/register.ts，仅在 production + browser 注册（dev 下避免破坏 HMR）。
 * 不提供 PWA manifest（本项目不做 PWA），SW 仅作访问加速。
 */

const CACHE_VERSION = "gaubee-sw-v1";
const CACHE_KEY = `gaubee-cache-${CACHE_VERSION}`;

// 预缓存的核心 SSG 入口（install 时主动拉取，保证首次离线可用）
const PRECACHE_URLS = ["/pages", "/pages/archive"];

/** 是否应该缓存该请求。 */
function shouldCache(request, url) {
  if (request.method !== "GET") return false;
  // 只缓存 /pages 或 /pages/*（精确边界，避免误匹配 /pagesXYZ）
  const p = url.pathname;
  if (p !== "/pages" && !p.startsWith("/pages/")) return false;
  // 跳过 raw markdown（总是取最新）
  if (p.startsWith("/pages/raw/")) return false;
  return true;
}

// install：预缓存核心入口 + 立即激活
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_KEY);
      // 并行预缓存（失败的忽略，避免阻塞激活）
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
      await Promise.all(
        keys.filter((k) => k !== CACHE_KEY).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// fetch：stale-while-revalidate（仅对 /pages）
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 只处理同源请求（跨域如 GitHub API、字体 CDN 透传）
  if (url.origin !== self.location.origin) return;
  if (!shouldCache(request, url)) return;

  event.respondWith(staleWhileRevalidate(request));
});

/**
 * Stale-While-Revalidate：
 * 1. 缓存命中 → 立即返回缓存 + 后台拉新更新缓存
 * 2. 缓存未命中 → 拉取网络，成功则缓存
 * 3. 网络失败 → 回退到缓存（任意 /pages 缓存，作离线兜底）
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_KEY);
  const cached = await cache.match(request);

  // 后台更新（不阻塞响应）
  const fetchAndUpdate = async () => {
    try {
      const response = await fetch(request);
      // 只缓存成功响应（200）和基本响应类型
      if (response.ok || response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      // 网络失败：若有缓存返回的 task 已处理；这里返回 undefined 让上层兜底
      return undefined;
    }
  };

  if (cached) {
    // 命中：立即返回缓存，后台更新
    fetchAndUpdate(); // fire and forget
    return cached;
  }

  // 未命中：等网络
  const networkResponse = await fetchAndUpdate();
  if (networkResponse) return networkResponse;

  // 全失败：尝试从缓存里找任意 /pages HTML 作离线兜底
  const fallback = await cache.match("/pages");
  if (fallback) return fallback;

  return new Response("离线且无缓存", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// 收到新 SW 后通知客户端刷新（可选，提升体验）
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
