/**
 * 应用加载状态 store（runes）。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-23）：应用首次打开时异步加载视图，状态栏顶部需显示 indeterminate 进度条。
 *
 * 设计取舍：
 * - 独立于 navStore 的纯函数 reducer 模型（reducer 是持久化/URL 编码的纯逻辑，loading 是瞬态 UI 态）。
 * - 用 route（entry route / TabId）作为加载标识，与 AreaOutlet 的 tabId 对齐。
 * - Set 的增删触发 $state 响应，SystemStatusBar 订阅 isLoading 驱动进度条。
 *
 * 生命周期：
 *   AreaOutlet 触发 loader 前 → start(route)
 *   loader resolve 后          → done(route)
 *   进度条在 isLoading=true 期间常显。
 */
class AppLoadStore {
  /** 正在加载视图的应用 route 集合（TabId / entry route）。 */
  private opening = $state<Set<string>>(new Set());

  /** 标记某应用视图开始加载。幂等。 */
  start(route: string): void {
    if (this.opening.has(route)) return;
    // $state Set 需重新赋值触发响应
    const next = new Set(this.opening);
    next.add(route);
    this.opening = next;
  }

  /** 标记某应用视图加载完成。幂等。 */
  done(route: string): void {
    if (!this.opening.has(route)) return;
    const next = new Set(this.opening);
    next.delete(route);
    this.opening = next;
  }

  /** 是否有应用正在加载（驱动状态栏进度条显隐）。 */
  get isLoading(): boolean {
    return this.opening.size > 0;
  }

  /** 某个 route 是否正在加载。 */
  isOpening(route: string): boolean {
    return this.opening.has(route);
  }
}

/** 全局单例。 */
export const appLoadStore = new AppLoadStore();
