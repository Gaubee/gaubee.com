<!--
	最近文章 Widget：桌面小组件，展示最近 5 篇文章。
	数据源 readonlyVfs（构建时静态数据，零延迟）。点击跳转文章详情。
-->
<script lang="ts">
  import { readonlyVfs, type ReadonlyPost } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'

  let posts = $state<ReadonlyPost[]>([])

  $effect(() => {
    posts = readonlyVfs
      .getPostsByCollection('articles')
      .sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())
      .slice(0, 5)
  })

  function titleOf(p: ReadonlyPost): string {
    return p.metadata.title ?? p.id.slug ?? p.id.stem
  }
  function open(p: ReadonlyPost) {
    navController.navigateMain(`/article/articles/${p.id.stem}`)
  }
</script>

{#if posts.length === 0}
  <p class="text-muted-foreground text-xs">暂无文章</p>
{:else}
  <ul class="widget-list">
    {#each posts as p (p.path)}
      <li>
        <button class="widget-item" onclick={() => open(p)}>
          <span class="widget-item-title">{titleOf(p)}</span>
          <span class="widget-item-date">
            {p.metadata.date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .widget-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .widget-item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border-radius: 0.5rem;
    text-align: left;
    transition: background 0.15s;
  }
  .widget-item:hover {
    background: var(--accent);
  }
  .widget-item-title {
    font-size: 0.8125rem;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .widget-item-date {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    flex-shrink: 0;
  }
</style>
