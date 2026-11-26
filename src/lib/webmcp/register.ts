/**
 * WebMCP 工具注册：把 SITE_TOOLS 暴露给浏览器/外部 Agent。
 *
 * 仅 Chrome 149+ Origin Trial（document.modelContext）可用；注册失败只告警。
 * 模块级单例保证 SPA 路由切换/HMR 不会重复注册。
 */
import { callTool, SITE_TOOLS } from "$lib/ai/tools";

interface ActiveRegistration {
  controller: AbortController;
  cancel: () => void;
}

const noop = () => {};

let active: ActiveRegistration | null = null;

/**
 * 注册站内只读工具，返回取消函数。
 *
 * - 能力不可用时返回空函数，页面无任何副作用。
 * - 已注册时复用同一取消函数，避免重复注册。
 */
export function registerSiteTools(): () => void {
  if (typeof document === "undefined") return noop;
  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return noop;
  if (active) return active.cancel;

  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  const cancel = () => {
    if (active?.controller !== controller) return;
    active = null;
    controller.abort();
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch (cause) {
        console.warn("[webmcp] 注销工具失败", cause);
      }
    }
  };

  active = { controller, cancel };

  try {
    for (const tool of SITE_TOOLS) {
      const cleanup = modelContext.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: (input, options) =>
            callTool(
              tool.name,
              input,
              options?.signal
                ? AbortSignal.any([options.signal, controller.signal])
                : controller.signal,
            ),
        },
        { signal: controller.signal },
      );
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
  } catch (cause) {
    console.warn("[webmcp] 工具注册失败", cause);
    cancel();
  }

  return cancel;
}
