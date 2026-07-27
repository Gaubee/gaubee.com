<!--
	EmptyState：空数据占位（图标 + 文案，居中）。

	统一 GithubApp 内「已加载但列表为空」的视觉（此前各视图 padding/图标不一致）。
	参考 SearchView 的「图标 + 提示 + min-h 居中」形状。
-->
<script lang="ts">
  import type { Component } from "svelte";
  import InboxIcon from "@lucide/svelte/icons/inbox";

  let {
    message = "暂无数据",
    icon = InboxIcon,
    class: className = "",
  }: {
    message?: string;
    icon?: Component<{ class?: string }>;
    class?: string;
  } = $props();
</script>

<div
  class="text-muted-foreground flex min-h-24 flex-col items-center justify-center gap-2 py-8 text-center text-sm {className}"
>
  <icon class="size-7 opacity-50"></icon>
  <p>{message}</p>
</div>
