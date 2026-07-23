<!--
	AppShell：应用隔离容器（iPadOS App Window）。

	正交意图：
	1. 堆叠隔离（2026-07-23）：isolation:isolate 建独立堆叠上下文，
	   应用内 position:fixed / z-* 被封印在容器内，绝不穿透到 shell。
	2. Portal 锚定（2026-07-23）：内嵌 app-portal-root，bits-ui Portal 默认挂这里，
	   不逃逸到 document.body。
	3. 上下文下发（2026-07-23）：setPortalTarget + setAppContext，供子组件 useApp 消费。

	用法：AreaOutlet 用它包裹每个 main/bottom/deepLink 视图；pop 区是 shell 级浮层不包。
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AppManifest } from "$lib/apps/types";
  import { getEntryRoute } from "$lib/apps/types";
  import { setAppContext, setPortalTarget } from "./portal-context.svelte";

  let {
    app,
    pathname = "",
    children,
  }: {
    app: AppManifest;
    /** 当前 location pathname（运行时注入，供 useApp 消费）。 */
    pathname?: string;
    children: Snippet;
  } = $props();

  let portalRoot = $state<HTMLElement | null>(null);

  // 下发 portal 目标取值器 + 应用上下文。
  // 用 $effect 确保在 DOM mount 后 portalRoot 有值时 getter 才生效；
  // getter 直接读 portalRoot（响应式），bits-ui 渲染时调用即可拿到真实元素。
  setPortalTarget(() => portalRoot);
  setAppContext({
    get manifest() {
      return {
        id: app.id,
        name: app.name,
        icon: app.icon,
      };
    },
    get pathname() {
      return pathname;
    },
  });
</script>

<div class="app-shell">
  {@render children()}
  <!-- 应用内浮层挂载点：bits-ui Portal 默认挂这里，不逃逸到 body -->
  <div class="app-portal-root" bind:this={portalRoot}></div>
</div>

<style>
  .app-shell {
    position: relative;
    isolation: isolate;
    height: 100%;
  }
  .app-portal-root {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* app-portal-root 仅作挂载锚点，本身不参与布局；子浮层各自定位 */
    z-index: var(--z-app-overlay);
  }
  /* 浮层内容需恢复 pointer-events（dialog/popover 等自身会设置） */
  .app-portal-root :global(*) {
    pointer-events: auto;
  }
</style>
