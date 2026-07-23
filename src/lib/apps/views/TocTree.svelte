<!--
	正交意图：
	1. 原始需求（2026-07-21）：长文章需要可用的桌面与移动 TOC。
	2. 原始需求（2026-07-22）：足够宽的桌面端将 TOC 放在正文右侧；外层导航吸顶，内部目录独立滚动。
	3. 展示与正文 GFM heading id 完全一致的二、三级标题。
	4. 在滚动中标记当前阅读位置，并提供可访问的移动 Sheet。
-->
<script lang="ts">
  import { browser } from '$app/environment'
  import { extractMarkdownHeadings } from '$lib/markdown/headings'
  import * as Sheet from '$lib/components/ui/sheet'
  import { Button } from '$lib/components/ui/button'
  import ListIcon from '@lucide/svelte/icons/list'

  let { markdown = '' }: { markdown?: string } = $props()

  const toc = $derived(extractMarkdownHeadings(markdown))
  let activeId = $state('')
  let mobileOpen = $state(false)

  function scrollToHeading(id: string): void {
    if (!browser) return
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    mobileOpen = false
  }

  $effect(() => {
    if (!browser || toc.length === 0) return

    const headingElements = toc
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => heading !== null)

    if (headingElements.length === 0) return
    activeId = headingElements[0].id

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) activeId = (visible.target as HTMLElement).id
      },
      { rootMargin: '-18% 0px -68% 0px', threshold: 0 },
    )

    for (const heading of headingElements) observer.observe(heading)
    return () => observer.disconnect()
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
          <button
            class="block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors {item.level === 3 ? 'ml-3 w-[calc(100%-0.75rem)]' : ''} {activeId === item.id ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
            aria-current={activeId === item.id ? 'location' : undefined}
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
        class="absolute right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[var(--z-app-overlay)] rounded-lg shadow-sm md:bottom-20"
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
            <button
              class="flex w-full items-center rounded-md px-3 py-2.5 text-left text-sm transition-colors {item.level === 3 ? 'pl-7' : ''} {activeId === item.id ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
              aria-current={activeId === item.id ? 'location' : undefined}
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
