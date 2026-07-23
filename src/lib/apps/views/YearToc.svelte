<!--
	正交意图：
	1. 原始需求（2026-07-21）：文章列表需要按年份的 TOC。
	2. 原始需求（2026-07-22）：宽桌面将年份 TOC 放在列表右侧；外层导航吸顶，内部目录独立滚动。
	3. 在桌面侧栏和移动 Sheet 提供相同的年份项目。
-->
<script lang="ts">
  import type { ReadonlyPost } from '$lib/vfs/readonly'
  import * as Sheet from '$lib/components/ui/sheet'
  import { Button } from '$lib/components/ui/button'
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days'

  interface YearGroup {
    year: number
    count: number
  }

  let { posts, onSelectYear }: { posts: ReadonlyPost[]; onSelectYear: (year: number) => void } = $props()
  let mobileOpen = $state(false)

  const yearGroups = $derived.by((): YearGroup[] => {
    const groups = new Map<number, number>()
    for (const post of posts) {
      const year = post.metadata.date.getFullYear()
      groups.set(year, (groups.get(year) ?? 0) + 1)
    }
    return [...groups]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year)
  })

  function selectYear(year: number): void {
    onSelectYear(year)
    mobileOpen = false
  }
</script>

<nav class="hidden xl:sticky xl:top-8 xl:block" aria-label="按年份浏览文章">
  <div
    class="max-h-[calc(100dvh-4rem)] overflow-y-auto pr-2 scrollbar-thin scrollbar-track-transparent"
    data-year-toc-scroll-region
  >
    <h2 class="bg-background sticky top-0 mb-3 flex items-center gap-2 py-1 text-sm font-semibold text-muted-foreground">
      <CalendarDaysIcon class="size-4" />
      按年份浏览
    </h2>
    <div class="space-y-1">
      {#each yearGroups as group (group.year)}
        <button
          class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          onclick={() => selectYear(group.year)}
        >
          <span class="font-medium">{group.year}</span>
          <span class="text-muted-foreground text-xs">{group.count} 篇</span>
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
      class="fixed right-4 bottom-20 z-[var(--z-app-overlay)] rounded-lg shadow-sm"
      aria-label="按年份浏览文章"
      onclick={() => (mobileOpen = true)}
    >
      <CalendarDaysIcon class="size-5" />
    </Button>

    <Sheet.Content side="bottom" class="max-h-[72dvh] rounded-t-lg p-0" showCloseButton={false}>
      <Sheet.Header class="border-b px-4 py-3">
        <Sheet.Title class="flex items-center gap-2"><CalendarDaysIcon class="size-4" />按年份浏览</Sheet.Title>
        <Sheet.Description class="sr-only">跳转到对应年份的文章</Sheet.Description>
      </Sheet.Header>
      <nav class="max-h-[calc(72dvh-4rem)] overflow-y-auto p-2" aria-label="按年份浏览文章">
        {#each yearGroups as group (group.year)}
          <button
            class="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
            onclick={() => selectYear(group.year)}
          >
            <span class="font-medium">{group.year}</span>
            <span class="text-muted-foreground text-xs">{group.count} 篇</span>
          </button>
        {/each}
      </nav>
    </Sheet.Content>
  </Sheet.Root>
</div>
