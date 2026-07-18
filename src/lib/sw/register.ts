/**
 * Service Worker 注册。
 *
 * 仅在 production + browser 注册（dev 下 SW 会缓存热更资源，破坏 HMR）。
 * SW 文件（static/sw.js）由 adapter-static 拷贝到产物根 /sw.js。
 *
 * 应急禁用：设置环境变量 `VITE_DISABLE_SW=true` 后重新构建。
 */
import { browser } from "$app/environment";

/**
 * 注册 SSG 加速 SW。幂等，可重复调用。
 * 失败静默处理（SW 是渐进增强，不应阻塞主功能）。
 */
export async function registerSw(): Promise<void> {
  if (!browser) return;
  if (!import.meta.env.PROD) return; // dev 不注册
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  // 应急逃生开关
  if (import.meta.env.VITE_DISABLE_SW === "true") return;

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.debug("[sw] 已注册 service worker");
  } catch (e) {
    // 注册失败不阻塞应用
    console.warn("[sw] 注册失败：", e);
  }
}
