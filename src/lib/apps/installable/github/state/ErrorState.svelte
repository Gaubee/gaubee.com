<!--
	ErrorState：错误占位（图标 + 文案 + 可选重试按钮，role=alert）。

	统一 GithubApp 内「加载失败」的视觉与无障碍（此前仅 SearchView 有 role=alert，
	padding 在 py-4/py-8/px-3-py-4 间不一致）。
-->
<script lang="ts">
  import type { Component } from "svelte";
  import AlertTriangleIcon from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "$lib/components/ui/button";

  let {
    message,
    onRetry,
    icon = AlertTriangleIcon,
    retryLabel = "重试",
    class: className = "",
  }: {
    message: string;
    /** 重试回调（不传则不显示重试按钮）。 */
    onRetry?: () => void;
    icon?: Component<{ class?: string }>;
    retryLabel?: string;
    class?: string;
  } = $props();
</script>

<!-- role=alert + aria-live：屏幕阅读器自动播报错误（对齐系统提示词无障碍要求） -->
<div
  role="alert"
  aria-live="polite"
  class="text-destructive flex min-h-24 flex-col items-center justify-center gap-2 py-8 text-center text-sm {className}"
>
  <icon class="size-7 opacity-60"></icon>
  <p class="max-w-xs break-words">{message}</p>
  {#if onRetry}
    <Button variant="outline" size="sm" class="mt-1" onclick={onRetry}>
      {retryLabel}
    </Button>
  {/if}
</div>
