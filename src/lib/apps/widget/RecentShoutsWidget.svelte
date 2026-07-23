<!--
	最近说说 Widget：桌面小组件，展示最近 5 条说说摘要。
	数据源 readonlyVfs。点击跳转说说详情。相对时间格式（今天/N 天前）。
-->
<script lang="ts">
  import { readonlyVfs, type ReadonlyPost } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'

  const shouts = $derived(
    readonlyVfs
      .getPostsByCollection('events')
      .sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())
      .slice(0, 5),
  )

  function relTime(date: Date): string {
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days} 天前`
    if (days < 30) return `${Math.floor(days / 7)} 周前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
  function preview(p: ReadonlyPost): string {
    // 去掉 frontmatter 后的纯文本首行摘要
    const text = p.body.replace(/^#.*$/m, '').trim()
    return text.slice(0, 40) || '(无内容)'
  }
  function open(p: ReadonlyPost) {
    navController.navigateMain(`/article/events/${p.id.stem}`)
  }
</script>

{#if shouts.length === 0}
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
