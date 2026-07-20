/**
 * Svelte 5 runes adapter：把 NavController 的 subscribe/getSnapshot 桥接到 $state。
 *
 * 用法：
 * ```svelte
 * <script>
 *   import { navState } from '$lib/nav/nav.svelte';
 * </script>
 * <p>{navState.current.mainLocation.pathname}</p>
 * ```
 *
 * navState.current 是 reactive 的：NavController 任何 dispatch 后会更新它，
 * Svelte 模板会自动重渲染。
 */
import { navController } from "./nav-controller-instance";
import type { NavState } from "./controller";

class NavStore {
  /** 当前导航状态快照（reactive）。每次 NavController 变更都会替换为新引用。 */
  current = $state<NavState>(navController.getSnapshot());
  /** 是否已初始化（浏览器侧 init 完成）。 */
  ready = $state(false);

  private unsubscribe: (() => void) | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.start();
    }
  }

  /** 订阅 NavController（在浏览器环境）。 */
  start(): void {
    if (this.unsubscribe) return;
    // navController-instance 在模块加载时已 init，这里订阅即可。
    this.unsubscribe = navController.subscribe(() => {
      this.current = navController.getSnapshot();
    });
    this.current = navController.getSnapshot();
    this.ready = true;
  }

  /** 手动触发一次更新（用于 initNavController 后）。 */
  refresh(): void {
    this.current = navController.getSnapshot();
  }

  /** 取消订阅（测试 / SSR 用）。 */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ready = false;
  }
}

export const navStore = new NavStore();

// 便捷导出：直接拿当前快照（非 reactive，适用于事件处理函数内部一次性读取）。
export function getNavState(): NavState {
  return navController.getSnapshot();
}
