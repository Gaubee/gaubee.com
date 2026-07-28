<!--
	RefreshIndicator：有数据时的加载/错误顶部指示条。

	用于 refreshing（背景刷新）和 stale-error（刷新失败但保留旧数据）两种中间态：
	旧数据正常渲染，顶部叠一条细指示，提示用户「正在更新」或「更新失败可重试」，
	避免背景刷新时整块闪骨架打断阅读。
-->
<script lang="ts">
  import { motionFade } from "$lib/utils/motion";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import AlertTriangleIcon from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "$lib/components/ui/button";

  let {
    message,
    variant,
    onRetry,
  }: {
    /** 指示文案。refreshing 时省略则用「同步中…」。 */
    message?: string;
    /** 指示类型：refreshing=刷新中（旋转图标），error=stale 错误（警告图标 + 重试）。 */
    variant: "refreshing" | "error";
    /** error 变体的重试回调。 */
    onRetry?: () => void;
  } = $props();
</script>

{#if variant === "refreshing"}
  <div
    in:motionFade
    class="bg-primary/5 text-muted-foreground flex items-center justify-center gap-1.5 px-3 py-1 text-[11px]"
  >
    <RefreshCwIcon class="size-3 animate-spin" />
    <span>{message ?? "同步中…"}</span>
  </div>
{:else}
  <div
    in:motionFade
    class="bg-destructive/10 text-destructive flex items-center justify-center gap-2 px-3 py-1.5 text-[11px]"
  >
    <AlertTriangleIcon class="size-3 shrink-0" />
    <span class="min-w-0 truncate">{message ?? "更新失败，展示为上次的数据"}</span>
    {#if onRetry}
      <Button
        variant="ghost"
        size="sm"
        class="text-destructive hover:text-destructive h-5 shrink-0 px-1.5 text-[11px]"
        onclick={onRetry}
      >
        重试
      </Button>
    {/if}
  </div>
{/if}
