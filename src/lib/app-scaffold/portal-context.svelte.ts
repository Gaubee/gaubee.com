/**
 * Portal 目标上下文：让应用内 bits-ui Portal 挂到 AppShell 内部，而非 document.body。
 *
 * 痛点：shadcn-svelte 的 dialog/sheet/popover 等底层走 bits-ui Portal，
 * 默认挂 document.body → 应用 A 的 Dialog 逃出应用 DOM 子树，与 shell/其它应用浮层同层竞争。
 *
 * 方案：AppShell mount 时 setPortalTarget(() => appPortalRoot)；
 * 各 *-portal.svelte 组件 getPortalTarget() 取值，有则 {to} 透传给 bits-ui Portal。
 * context 存 getter（非元素本身）：svelte context 在组件创建时同步求值，
 * 但 portal root DOM 需 mount 后才存在；getter 延迟到 bits-ui 渲染时调用，安全。
 */
import { getContext, setContext, type Component } from "svelte";

const PORTAL_TARGET_KEY = Symbol("gaubee-portal-target");

export type PortalTargetGetter = () => HTMLElement | null;

/** AppShell mount 时调用：下发当前应用的 portal root 取值器。 */
export function setPortalTarget(getter: PortalTargetGetter): void {
  setContext(PORTAL_TARGET_KEY, getter);
}

/** 取当前 portal 目标（AppShell 内的 app-portal-root）。
 *  在 AppShell 外（shell 级组件如 Toaster）调用返回 null → bits-ui Portal fallback 到 body。 */
export function getPortalTarget(): PortalTargetGetter | undefined {
  return getContext<PortalTargetGetter>(PORTAL_TARGET_KEY);
}

// ---- App 上下文（useApp） ----

export interface AppContextValue {
  /** 当前应用 manifest。 */
  manifest: {
    id: string;
    name: string;
    icon: Component;
  };
  /** 当前应用在当前 area 的 location pathname（运行时由 AppShell 注入）。 */
  pathname: string;
}

const APP_CONTEXT_KEY = Symbol("gaubee-app-context");

/** AppShell 下发应用上下文（供 useApp 消费）。 */
export function setAppContext(value: AppContextValue): void {
  setContext(APP_CONTEXT_KEY, value);
}

/** 消费当前应用上下文（在 AppShell 内的子组件调用）。 */
export function useApp(): AppContextValue | undefined {
  return getContext<AppContextValue>(APP_CONTEXT_KEY);
}
