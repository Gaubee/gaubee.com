<!--
	AsyncBoundary：异步资源状态机渲染边界。

	接收一个 Resource，按其 status 自动渲染对应分支。调用方在 children snippet 内
	通过 resource.data 取数据（在 success/refreshing/stale-error 分支内，data 必非空，
	可用 {@const data = resource.data!} 断言）。

	状态分支：
	  loading       → skeleton snippet（或默认 Skeleton）
	  error         → ErrorState（图标 + 文案 + 重试）
	  empty         → EmptyState
	  refreshing    → RefreshIndicator（顶部条）+ children（保留旧数据）
	  stale-error   → RefreshIndicator(error)（顶部条）+ children（保留旧数据）
	  success       → children

	为什么不泛型：svelte-check 对 Resource<T> 这种包装类型的泛型推断有限（无法从
	resource 反推 T，也无法从 snippet 参数反推）。改为无泛型，调用方用 resource.data!
	取值，类型由调用方在 snippet 内的 {@const} 显式断言，更可靠。

	进场动画用 tw-animate-css 的 animate-in fade-in（CSS 类，reduced-motion 由 CSS 兜底）。

	用法：
	```svelte
	<AsyncBoundary resource={commits} skeleton={SkeletonRows} emptyMessage="暂无提交">
	  {#snippet children()}
	    {#const data = commits.data!}
	    {#each data as c}<CommitRow {c} />{/each}
	  {/snippet}
	</AsyncBoundary>
	```
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import {
    hasRenderableData,
    isErrorStatus,
  } from "./status";
  import type { ReadonlyResource } from "./resource.svelte";
  import EmptyState from "./EmptyState.svelte";
  import ErrorState from "./ErrorState.svelte";
  import RefreshIndicator from "./RefreshIndicator.svelte";

  let {
    resource,
    children,
    skeleton = undefined,
    skeletonCount = 3,
    skeletonClass = "h-16",
    emptyMessage = "暂无数据",
    errorMessage,
    onRetry = undefined,
  }: {
    resource: ReadonlyResource<unknown>;
    /** 数据就绪时渲染（success/refreshing/stale-error 分支）。调用方用 resource.data! 取值。 */
    children: Snippet;
    /** loading 骨架（调用方提供，因形态各异）。不传则用默认 Skeleton。 */
    skeleton?: Snippet;
    /** 默认骨架数量（skeleton 未提供时用）。 */
    skeletonCount?: number;
    /** 默认骨架行样式（skeleton 未提供时用）。 */
    skeletonClass?: string;
    emptyMessage?: string;
    /** 错误兜底文案（resource.error 为空时用）。 */
    errorMessage?: string;
    /** 重试回调（不传则用 resource.run）。 */
    onRetry?: () => void;
  } = $props();

  const status = $derived(resource.status);
  const showError = $derived(isErrorStatus(status) && !hasRenderableData(status));
  const showStaleError = $derived(status === "stale-error");
  const showRefreshing = $derived(status === "refreshing");
  const showEmpty = $derived(status === "empty");
  const showData = $derived(hasRenderableData(status));
  const isInitialLoading = $derived(status === "loading");

  const handleRetry = () => (onRetry ? onRetry() : void resource.run());
  const errorText = $derived(errorMessage ?? resource.error ?? "加载失败");
</script>

{#if isInitialLoading}
  <div class="animate-in fade-in-0 space-y-2 duration-150">
    {#if skeleton}
      {@render skeleton()}
    {:else}
      {#each Array(skeletonCount) as _}
        <Skeleton class={skeletonClass} />
      {/each}
    {/if}
  </div>
{:else if showError}
  <ErrorState message={errorText} onRetry={handleRetry} />
{:else if showData}
  {#if showRefreshing}
    <RefreshIndicator variant="refreshing" />
  {:else if showStaleError}
    <RefreshIndicator
      variant="error"
      message={resource.error ?? undefined}
      onRetry={handleRetry}
    />
  {/if}
  {#if showEmpty}
    <EmptyState message={emptyMessage} />
  {:else}
    {@render children()}
  {/if}
{/if}
