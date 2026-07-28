/**
 * View 注册（旧机制）—— 2026-07-27 路由重构后的过渡壳。
 *
 * 状态：tab/deep-link 视图懒加载已迁移到 manifest.activities[].root（RouteContract 树），
 *      由 ActivityRouter 统一渲染。本文件仅保留 pop 浮层的注册（搜索/通知），
 *      其余 register* 调用已全部删除。
 *
 * TODO 阶段 5：pop 浮层也迁移到 RouteContract 后，删除本文件。
 */
import { registerPopView } from "./registry";

let registered = false;

/** 注册所有 view loader（幂等，多次调用安全）。 */
export function ensureViewsRegistered(): void {
  if (registered) return;
  registered = true;

  // ===== pop views（hiddenFromNav pop 应用，只走浮层）=====
  // TODO 阶段 5：pop 区也迁移到 Activity 模型后删除
  registerPopView("/app/search", () => import("./SearchView.svelte"));
  registerPopView("/app/notifications", () => import("$lib/apps/views/NotificationsView.svelte"));
}

// 模块加载时立即注册
ensureViewsRegistered();
