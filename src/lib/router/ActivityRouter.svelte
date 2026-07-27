<!--
	ActivityRouter：Activity 内部路由树渲染组件。

	设计意图（2026-07-27）：
	AppShell 内置此组件，传入当前激活的 activity + location，
	负责：
	1. 调用 matchRouteTree 解析 pathname/search
	2. 异步加载叶子 Route 的 component（缓存保活）
	3. 通过 setRouterContext 下发 params/search 给视图组件
	4. 处理 no-match / parse-error 兜底渲染

	保活策略：
	- 每个 RouteId 对应的组件实例缓存到 Map（同 AreaOutlet loadedSlots 模式）
	- 切换 Route 时，旧组件不卸载（保留 DOM 与 state），新组件按需加载挂载
	- 仅当前激活的 Route 显示，其余 visibility:hidden

	与 AreaOutlet 的分工：
	- AreaOutlet 负责「跨应用」保活（按 tabId 缓存整个 AppShell + 视图）
	- ActivityRouter 负责「应用内」保活（按 RouteId 缓存叶子组件）
-->
<script lang="ts">
  import type { Component } from "svelte";
  import { untrack } from "svelte";
  import type { HistoryLocation } from "$lib/nav/controller";
  import type { AppActivity } from "$lib/apps/types";
  import { appLoadStore } from "$lib/apps/app-load.svelte";

  import type { ErasedRouteContract } from "./contract";
  import { matchRouteTree, type MatchedRouteNode, type RouteMatchResult } from "./match";
  import { setRouterContext, type RouterContextValue } from "./hooks.svelte";

  let {
    activity,
    location,
  }: {
    activity: AppActivity;
    location: HistoryLocation;
  } = $props();

  // root 在 AppActivity 类型层带泛型 P/S，运行时擦除后是 ErasedRouteContract。
  // matchRouteTree 接受 ErasedRouteContract，这里显式擦除。
  // activity prop 由 AreaOutlet 传入，每个 overlay 对应一个固定的 activity（保活模型）。
  // $derived 保证 location 变化时 matchResult 重新计算（追踪 activity.root + location）。
  const erasedRoot: ErasedRouteContract = $derived(activity.root);

  // 1. 路由匹配（纯函数派生）
  const matchResult: RouteMatchResult = $derived(
    matchRouteTree(erasedRoot, location.pathname, location.search, activity.pattern),
  );

  // 2. 当前激活的叶子 Route 节点
  const activeLeaf: MatchedRouteNode | undefined = $derived(
    matchResult.kind === "matched" ? matchResult.chain[matchResult.chain.length - 1] : undefined,
  );

  // 3. params / search parse（仅 matched 时有效）
  const parsedParams = $derived.by(() => {
    if (matchResult.kind !== "matched") return undefined;
    const leaf = matchResult.chain[matchResult.chain.length - 1].route;
    if (!leaf.params) return undefined;
    // matchRouteTree 已校验过 safeParse，这里直接 parse 取值
    const r = (leaf.params as never as { safeParse: (x: unknown) => { success: boolean; data?: unknown } }).safeParse(
      mergeRawParams(matchResult.chain),
    );
    return r.success ? r.data : undefined;
  });

  const parsedSearch = $derived.by(() => {
    if (matchResult.kind !== "matched") return undefined;
    const leaf = matchResult.chain[matchResult.chain.length - 1].route;
    if (!leaf.search) return undefined;
    const searchObj = parseSearchQuick(location.search);
    const r = (leaf.search as never as { safeParse: (x: unknown) => { success: boolean; data?: unknown } }).safeParse(searchObj);
    return r.success ? r.data : undefined;
  });

  // 4. 组件异步加载 + 缓存保活
  //    用数组而非 Map：Svelte 5 runes 对 $state(Array) 的 push/splice 有原生响应式追踪，
  //    而 Map.set() 不触发响应式（除非整个 Map 重新赋值）。
  //    每个已加载的 RouteId + Component 存为一个 slot。
  const loadedSlots = $state<Array<{ routeId: string; component: Component }>>([]);
  const inFlight = new Set<string>();

  function getLoadedComponent(routeId: string): Component | undefined {
    return loadedSlots.find((s) => s.routeId === routeId)?.component;
  }

  $effect(() => {
    const leaf = activeLeaf;
    if (!leaf) return;
    const routeId = leaf.route.id;
    if (getLoadedComponent(routeId) || inFlight.has(routeId)) return;
    inFlight.add(routeId);
    appLoadStore.start(`route:${routeId}`);
    leaf.route
      .component()
      .then((m) => {
        // 检查避免重复（effect 重入时）
        if (!loadedSlots.some((s) => s.routeId === routeId)) {
          loadedSlots.push({ routeId, component: m.default });
        }
      })
      .finally(() => {
        inFlight.delete(routeId);
        appLoadStore.done(`route:${routeId}`);
      });
  });

  // 5. 注入 Router 上下文（供子组件 useRoute/useParams/useSearch 消费）
  //    用 $derived 保证 location 变化时 context 数据是最新的
  const ctxValue: RouterContextValue = $derived({
    activity,
    location: { pathname: location.pathname, search: location.search },
    match: matchResult,
    params: parsedParams as Readonly<Record<string, unknown>> | undefined,
    search: parsedSearch as Readonly<Record<string, unknown>> | undefined,
    chain: matchResult.kind === "matched" ? matchResult.chain : [],
  });
  setRouterContext(() => ctxValue);

  // 工具函数（同 match.ts 内部实现，这里为了不破坏 match.ts 的纯度，单独写一份）
  function mergeRawParams(chain: readonly MatchedRouteNode[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const node of chain) Object.assign(merged, node.rawParams);
    return merged;
  }
  function parseSearchQuick(search: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!search) return out;
    const s = search.startsWith("?") ? search.slice(1) : search;
    if (!s) return out;
    for (const pair of s.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const val = eq === -1 ? "" : pair.slice(eq + 1);
      try {
        out[decodeURIComponent(key)] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
    return out;
  }
</script>

{#if matchResult.kind === "matched" && activeLeaf}
  {@const Comp = getLoadedComponent(activeLeaf.route.id)}
  {#if Comp}
    <!-- key 绑定 RouteId，切换 Route 时 Svelte 会替换组件实例（每个 Route 独立 state） -->
    <div class="activity-route-outlet" data-route-id={activeLeaf.route.id}>
      <Comp />
    </div>
  {:else}
    <div class="app-skeleton h-full" aria-label="加载中"></div>
  {/if}
{:else if matchResult.kind === "no-match"}
  <!-- Activity 内无 Route 命中：通常意味着 URL 指向了 Activity 入口但 root 无 index route -->
  <!-- 这种情况由上层 AreaOutlet 的 NotFound 兜底处理，这里渲染空 -->
  <div class="activity-route-empty"></div>
{:else if matchResult.kind === "parse-error"}
  <!-- zod parse 失败：参数错误 -->
  <div class="activity-route-error p-4 text-destructive text-sm">
    路由参数解析失败（{matchResult.reason}）
  </div>
{/if}

<style>
  .activity-route-outlet {
    height: 100%;
  }
  .app-skeleton {
    width: 100%;
    min-height: 100%;
    background: var(--muted);
    animation: skeleton-pulse 1.6s ease-in-out infinite;
  }
  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .app-skeleton {
      animation: none;
    }
  }
</style>
