<!--
	EventBody：事件列表条目的正文渲染。

	客观渲染 markdown（与详情页同源，MarkdownViewer inline），
	但高度设上限：超限时渐隐收口并出现「查看全文」引导到详情页（2026-10-05 kzf 裁决）。
	溢出检测用 ResizeObserver——图片懒加载完成后高度会变，需复检。
-->
<script lang="ts">
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right'

  let {
    body,
    href,
    onclick,
  }: {
    body: string
    href: string
    onclick?: (event: MouseEvent) => void
  } = $props()

  let el = $state<HTMLElement | null>(null)
  let overflowing = $state(false)

  $effect(() => {
    if (!el) return
    const check = () => {
      overflowing = el !== null && el.scrollHeight > el.clientHeight + 4
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  })
</script>

<div class="event-markdown text-[15px] leading-6 text-foreground">
  <div bind:this={el} class="event-clamped" class:event-clamped-on={overflowing}>
    <MarkdownViewer markdown={body} inline />
  </div>
  {#if overflowing}
    <a class="text-primary mt-2 inline-flex items-center gap-1 text-sm font-medium hover:underline" {href} {onclick}>
      查看全文
      <ArrowUpRightIcon class="size-3.5" />
    </a>
  {/if}
</div>

<style>
  .event-clamped {
    max-height: 420px;
    overflow: hidden;
  }
  .event-clamped-on {
    position: relative;
  }
  .event-clamped-on::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 64px;
    background: linear-gradient(to bottom, transparent, var(--background));
    pointer-events: none;
  }
</style>
