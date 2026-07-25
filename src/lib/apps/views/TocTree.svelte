<!--
	正交意图：
	1. 原始需求（2026-07-21）：长文章需要可用的桌面与移动 TOC。
	2. 原始需求（2026-07-22）：足够宽的桌面端将 TOC 放在正文右侧；外层导航吸顶，内部目录独立滚动。
	3. 展示与正文 GFM heading id 完全一致的二、三级标题。
	4. 原始需求（2026-07-26）：ToC 高亮基于 AST 范围 ∩ viewport 比例渐变（0~100%），
	   由 src/lib/components/toc/scroll-spy 通用基础设施驱动。
-->
<script lang="ts">
  import { browser } from '$app/environment'
  import { extractMarkdownHeadings } from '$lib/markdown/headings'
  import {
    createMarkdownHeadingDetector,
    createScrollSpy,
    findScrollParent,
    type HighlightMap,
    type ScrollSpyHandle,
  } from '$lib/components/toc/scroll-spy.dom'
  import * as Sheet from '$lib/components/ui/sheet'
  import { Button } from '$lib/components/ui/button'
  import ListIcon from '@lucide/svelte/icons/list'

  let {
    markdown = '',
    /** 正文容器（含 h2/h3[id]）。由宿主 ArticleDetailView 通过 bind:this 传入。 */
    contentEl = undefined,
  }: {
    markdown?: string
    contentEl?: HTMLElement
  } = $props()

  const toc = $derived(extractMarkdownHeadings(markdown))
  let highlights = $state<HighlightMap>(new Map())
  let mobileOpen = $state(false)
  let spyHandle: ScrollSpyHandle | undefined = $state()

  function scrollToHeading(id: string): void {
    if (!browser) return
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    mobileOpen = false
  }

  // 找最近的可滚动祖先作为视口（详情页走 deep-link 分支，滚动容器是
  // div.h-full.overflow-auto；普通 tab 应用走 .app-overlay-layer）。
  // 不能用 closest('.main-content')——它是 overflow:hidden 不滚动。
  $effect(() => {
    if (!browser || !contentEl || toc.length === 0) return
    const viewport = findScrollParent(contentEl)
    if (!viewport) return

    const handle = createScrollSpy({
      container: contentEl,
      detector: createMarkdownHeadingDetector(),
      viewport,
      topOffset: 80,
      onUpdate: (m) => (highlights = m),
    })
    spyHandle = handle
    return () => {
      handle.destroy()
      spyHandle = undefined
    }
  })
</script>

{#if toc.length > 0}
  <nav class="hidden xl:sticky xl:top-8 xl:block" aria-label="文章目录">
    <div
      class="max-h-[calc(100dvh-4rem)] overflow-y-auto pr-2 scrollbar-thin scrollbar-track-transparent"
      data-toc-scroll-region
    >
      <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <ListIcon class="size-4" />
        目录
      </h2>
      <div class="space-y-1">
        {#each toc as item (item.id)}
          {@const ratio = highlights.get(item.id) ?? 0}
          <button
            class="toc-item block w-full rounded-e-md rounded-s-none px-2 py-1.5 text-left text-sm transition-colors {item.level === 3 ? 'ml-3 w-[calc(100%-0.75rem)]' : ''}"
            style="--toc-highlight: {ratio}"
            aria-current={ratio > 0.5 ? 'location' : undefined}
            onclick={() => scrollToHeading(item.id)}
          >
            <span class="block truncate">{item.text}</span>
          </button>
        {/each}
      </div>
    </div>
  </nav>

  <div class="xl:hidden">
    <Sheet.Root bind:open={mobileOpen}>
      <Button
        variant="outline"
        size="icon"
        class="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[var(--z-app-overlay)] rounded-lg shadow-sm md:bottom-20"
        aria-label="打开文章目录"
        onclick={() => (mobileOpen = true)}
      >
        <ListIcon class="size-5" />
      </Button>

      <Sheet.Content side="bottom" class="max-h-[72dvh] rounded-t-lg p-0" showCloseButton={false}>
        <Sheet.Header class="border-b px-4 py-3">
          <Sheet.Title class="flex items-center gap-2"><ListIcon class="size-4" />目录</Sheet.Title>
          <Sheet.Description class="sr-only">跳转到文章标题</Sheet.Description>
        </Sheet.Header>
        <nav class="max-h-[calc(72dvh-4rem)] overflow-y-auto p-2" aria-label="文章目录">
          {#each toc as item (item.id)}
            {@const ratio = highlights.get(item.id) ?? 0}
            <button
              class="toc-item flex w-full items-center rounded-e-md rounded-s-none px-3 py-2.5 text-left text-sm transition-colors {item.level === 3 ? 'ml-3 w-[calc(100%-0.75rem)]' : ''}"
              style="--toc-highlight: {ratio}"
              aria-current={ratio > 0.5 ? 'location' : undefined}
              onclick={() => scrollToHeading(item.id)}
            >
              <span class="line-clamp-2">{item.text}</span>
            </button>
          {/each}
        </nav>
      </Sheet.Content>
    </Sheet.Root>
  </div>
{/if}

<style>
  /* ToC 项渐变高亮：背景/文字色/左侧 indicator 强度随 --toc-highlight（0~1）变化。
   * 用 color-mix 平滑过渡，避免二态切换的生硬感。 */
  .toc-item {
    --toc-highlight: 0;
    background: color-mix(in oklch, var(--accent) calc(var(--toc-highlight) * 100%), transparent);
    color: color-mix(
      in oklch,
      var(--foreground) calc(var(--toc-highlight) * 100%),
      var(--muted-foreground)
    );
    font-weight: calc(400 + var(--toc-highlight) * 200);
    /* 左侧 indicator：随高亮延伸的彩色竖线 */
    box-shadow: inset 2px 0 0
      color-mix(in oklch, var(--primary) calc(var(--toc-highlight) * 100%), transparent);
  }
  .toc-item:hover {
    background: color-mix(in oklch, var(--accent) 60%, transparent);
  }
</style>
