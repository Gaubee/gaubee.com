<!--
	标签云 Widget：桌面小组件，展示热门标签。
	数据源 readonlyVfs（统计所有文章/说说的标签频次）。点击跳转标签页。
-->
<script lang="ts">
  import { readonlyVfs } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'

  type TagCount = { tag: string; count: number }

  let tags = $state<TagCount[]>([])

  $effect(() => {
    const counts = new Map<string, number>()
    for (const p of readonlyVfs.getPosts()) {
      for (const t of p.metadata.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
  })

  function open(tag: string) {
    navController.navigateMain(`/tags/${tag}`)
  }
  // 按频次映射字号
  function tagClass(count: number): string {
    if (count >= 5) return 'tag-lg'
    if (count >= 3) return 'tag-md'
    return 'tag-sm'
  }
</script>

{#if tags.length === 0}
  <p class="text-muted-foreground text-xs">暂无标签</p>
{:else}
  <div class="tag-cloud">
    {#each tags as { tag, count } (tag)}
      <button class="tag-chip {tagClass(count)}" onclick={() => open(tag)}>
        {tag}
        <span class="tag-count">{count}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    background: var(--secondary);
    color: var(--secondary-foreground);
    transition: background 0.15s;
  }
  .tag-chip:hover {
    background: var(--accent);
  }
  .tag-lg {
    font-size: 0.875rem;
    font-weight: 600;
  }
  .tag-md {
    font-size: 0.8125rem;
  }
  .tag-sm {
    font-size: 0.75rem;
    opacity: 0.85;
  }
  .tag-count {
    font-size: 0.625rem;
    opacity: 0.6;
  }
</style>
