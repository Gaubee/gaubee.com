<!--
	SearchView：全文搜索（pop 区）。
	基于 contentStore 的已加载内容做客户端 minisearch 搜索。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import MiniSearch from 'minisearch'
  import { contentStore, type Post } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Input } from '$lib/components/ui/input'

  let query = $state('')
  let results = $state<Array<{ id: string; post: Post; score: number }>>([])
  let miniSearch: MiniSearch<Post> | null = null

  function buildIndex() {
    if (contentStore.state.posts.length === 0) return
    miniSearch = new MiniSearch({
      fields: ['title', 'body', 'tags'],
      storeFields: ['path', 'collection', 'filename'],
      extractField: (doc, fieldName) => {
        if (fieldName === 'title') return doc.metadata.title ?? doc.id.stem
        if (fieldName === 'tags') return doc.metadata.tags.join(' ')
        if (fieldName === 'body') return doc.body.slice(0, 2000) // 限制索引大小
        return (doc as unknown as Record<string, string>)[fieldName] ?? ''
      },
    })
    miniSearch.addAll(contentStore.state.posts)
  }

  onMount(() => {
    if (contentStore.state.loaded) buildIndex()
    else contentStore.refresh().then(buildIndex)
  })

  // 内容刷新后重建索引
  $effect(() => {
    if (contentStore.state.loaded && contentStore.state.posts.length > 0 && !miniSearch) {
      buildIndex()
    }
  })

  function search() {
    if (!miniSearch || !query.trim()) {
      results = []
      return
    }
    try {
      const hits = miniSearch.search(query, { prefix: true, fuzzy: 0.2 })
      results = hits.slice(0, 20).map((h) => {
        const post = contentStore.state.posts.find((p) => p.path === h.path)!
        return { id: h.id, post, score: h.score }
      })
    } catch {
      results = []
    }
  }

  function openResult(post: Post) {
    navController.deactivatePop()
    navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)
  }

  function highlight(text: string): string {
    if (!query.trim()) return text
    const terms = query.trim().split(/\s+/).filter(Boolean)
    let result = text
    for (const term of terms) {
      result = result.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>')
    }
    return result
  }
</script>

<div class="flex flex-col gap-3">
  <Input
    type="search"
    value={query}
    oninput={(e) => {
      query = e.currentTarget.value
      search()
    }}
    placeholder="搜索文章与短评…"
    autofocus
  />

  {#if query && results.length === 0}
    <p class="text-muted-foreground py-4 text-center text-sm">
      {contentStore.state.loaded ? '没有匹配的结果' : '内容加载中…'}
    </p>
  {:else}
    <div class="flex flex-col gap-1">
      {#each results as r (r.id)}
        <button
          class="hover:bg-accent rounded-md p-2 text-left transition-colors"
          onclick={() => openResult(r.post)}
        >
          <div class="text-muted-foreground mb-0.5 text-xs">
            {r.post.collection === 'articles' ? '文章' : '短评'}
          </div>
          <div class="truncate text-sm font-medium">
            {@html highlight(r.post.metadata.title ?? r.post.id.stem)}
          </div>
          {#if r.post.body}
            <div class="text-muted-foreground truncate text-xs">
              {@html highlight(r.post.body.slice(0, 100))}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
