<!--
	AppShell：应用隔离容器 + 通用开发范式承载者（iPadOS App Window）。

	正交意图（5 个，已达上限）：
	1. 堆叠隔离（2026-07-23）：isolation:isolate 建独立堆叠上下文，
	   应用内 position:fixed / z-* 被封印在容器内，绝不穿透到 shell。
	2. Portal 锚定（2026-07-23）：内嵌 app-portal-root，bits-ui Portal 默认挂这里，
	   不逃逸到 document.body。
	3. 上下文下发（2026-07-23）：setPortalTarget + setAppContext，供子组件 useApp 消费。
	4. Activity Router 挂载（2026-07-27）：内置 <ActivityRouter>，
	   把当前 activity 的 Route 树渲染委托给它，统一应用内多页面导航模型。
	5. 通用视图状态兜底（2026-07-27，规划中）：Loading/Error/Empty 默认渲染契约。
	   目前由 ActivityRouter 自身处理，后续可下沉为 AppShell 的统一 fallback。

	⚠ 重构警报（2026-07-27）：5 个正交意图已达上限。后续若需继续扩展，
	   应拆分为 <AppShell>（仅 1/2/3 隔离容器）+ <ActivityScaffold>（4/5 路由+状态兜底）两层。

	用法：AreaOutlet 用它包裹每个 main/bottom 视图；pop 区是 shell 级浮层不包。
	版本（2026-07-27）：activity 从外部传入，AppShell 内置 ActivityRouter 渲染 Route 树。
-->
<script lang="ts">
  import type { HistoryLocation } from "$lib/nav/controller";
  import type { AppActivity, AppManifest } from "$lib/apps/types";
  import ActivityRouter from "$lib/router/ActivityRouter.svelte";
  import { setAppContext, setPortalTarget } from "./portal-context.svelte";

  let {
    app,
    activity,
    location,
  }: {
    app: AppManifest;
    /** 当前激活的 Activity（AreaOutlet 从 manifest.activities 中匹配得到）。 */
    activity: AppActivity;
    /** 当前 area 的 location（main/bottom/pop 之一）。 */
    location: HistoryLocation;
  } = $props();

  let portalRoot = $state<HTMLElement | null>(null);

  // 下发 portal 目标取值器 + 应用上下文。
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
      return location.pathname;
    },
  });
</script>

<div class="app-shell">
  <ActivityRouter {activity} {location} />
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
