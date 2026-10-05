<!--
	EventBody：事件列表条目的正文渲染。

	客观渲染 markdown（与详情页同源样式：prose 排版 + MarkdownViewer inline），
	全文直接渲染，不做高度截断（2026-10-05 kzf 裁决：列表简单实用，避免二次操作）。
	xvideo action 增强容器内的归档视频（自动播放/单实例/手势）。
-->
<script lang="ts">
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { xvideo } from '$lib/player/x-video'

  let { body }: { body: string } = $props()
</script>

<div class="event-markdown prose prose-sm dark:prose-invert max-w-none text-[15px] leading-6 text-foreground" use:xvideo>
  <MarkdownViewer markdown={body} inline />
</div>
