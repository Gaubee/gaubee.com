<!--
	最近说说 Widget：桌面小组件，展示最近 5 条说说摘要。
	数据源 contentQuery（内容管道）。点击跳转说说详情。相对时间格式（今天/N 天前）。
-->
<script lang="ts">
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'

  const shouts = $derived.by<ContentEntry[]>(() => {
    void contentQuery.version
    return contentQuery.listEvents({ limit: 5 })
  })
  const loading = $derived(!contentQuery.initialized)

  function relTime(date: Date): string {
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days} 天前`
    if (days < 30) return `${Math.floor(days / 7)} 周前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
  function preview(p: ContentEntry): string {
    // 统一管道 excerpt（已去 markdown 符号），取前 40 字
    const text = p.excerpt.trim()
    return text.slice(0, 40) || '(无内容)'
  }
  function open(p: ContentEntry) {
    navController.navigateMain(`/article/events/${p.id.stem}`)
  }
</script>

{#if loading}
  <p class="text-muted-foreground text-xs">加载中…</p>
{:else if shouts.length === 0}
  <p class="text-muted-foreground text-xs">暂无说说</p>
{:else}
  <ul class="widget-list">
    {#each shouts as p (p.path)}
      <li>
        <button class="widget-item" onclick={() => open(p)}>
          <span class="widget-item-preview">{preview(p)}</span>
          <span class="widget-item-time">{relTime(p.metadata.date)}</span>
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
    flex-direction: column;
    gap: 0.125rem;
    width: 100%;
    padding: 0.5rem;
    border-radius: 0.5rem;
    text-align: left;
    transition: background 0.15s;
  }
  .widget-item:hover {
    background: var(--accent);
  }
  .widget-item-preview {
    font-size: 0.8125rem;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .widget-item-time {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
