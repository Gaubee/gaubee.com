<!--
	HomeView：GithubEditorApp 首页。

	结构（三段式）：
	1. 顶部：收藏仓库（repoFavorites.items 实时订阅，卡片点击进编辑器）
	2. 中间：GitHub 链接输入框（parseGithubUrl 解析 → 跳转编辑器）
	3. 底部：最近打开（recentRepos.items，上限 20 个）

	数据源：
	- repoFavorites：GithubApp 的收藏（响应式单例，跨应用共享）
	- recentRepos：GithubEditor 自己的最近打开记录
	- 两者都只存 owner/repo 身份，元数据（description/star）渲染时批量 getRepo 拉
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { repoFavorites } from '$lib/apps/installable/github/favorites.svelte'
  import { recentRepos } from '../recent-repos.svelte'
  import { getRepo, type RepoSummary } from '$lib/apps/installable/github/repo-api'
  import { parseGithubUrl, type ParsedGithubUrl } from '$lib/github/parse-url'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import StarIcon from '@lucide/svelte/icons/star'
  import GitForkIcon from '@lucide/svelte/icons/git-branch'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right'
  import ClockIcon from '@lucide/svelte/icons/clock'
  import SearchIcon from '@lucide/svelte/icons/search'

  // 响应式数据
  const favorites = $derived(repoFavorites.items)
  const recents = $derived(recentRepos.items)
  /** 首屏初始加载（store init 期间显示骨架）。 */
  const initialLoading = $derived(!repoFavorites.initialized || !recentRepos.initialized)

  // 元数据缓存（owner/repo → RepoSummary，渲染时批量拉取）
  let repoMeta = $state<Map<string, RepoSummary>>(new Map())
  let metaLoading = $state(false)

  // 链接输入
  let urlInput = $state('')
  let urlError = $state<string | null>(null)

  onMount(() => {
    void repoFavorites.init()
    void recentRepos.init()
  })

  // 收藏 + 最近打开变化时批量拉元数据
  $effect(() => {
    const ids = new Set<string>()
    for (const f of favorites) ids.add(`${f.owner}/${f.repo}`)
    for (const r of recents) ids.add(`${r.owner}/${r.repo}`)
    if (ids.size === 0) return
    void loadMeta(Array.from(ids))
  })

  async function loadMeta(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !repoMeta.has(id))
    if (missing.length === 0) return
    metaLoading = true
    try {
      const results = await Promise.all(
        missing.map(async (id) => {
          const [owner, repo] = id.split('/')
          try {
            return [id, await getRepo(owner, repo)] as const
          } catch {
            return [id, null] as const
          }
        }),
      )
      const next = new Map(repoMeta)
      for (const [id, info] of results) {
        if (info) next.set(id, info)
      }
      repoMeta = next
    } finally {
      metaLoading = false
    }
  }

  /** 跳转到编辑工作区。 */
  function openRepo(owner: string, repo: string, opts: { ref?: string; file?: string } = {}) {
    const params = new URLSearchParams()
    if (opts.ref) params.set('ref', opts.ref)
    if (opts.file) params.set('file', opts.file)
    const qs = params.toString()
    navController.navigateMain(`/app/github-editor/repo/${owner}/${repo}${qs ? `?${qs}` : ''}`)
  }

  /** 解析输入的链接并跳转。 */
  function handleOpenUrl(): void {
    urlError = null
    const parsed = parseGithubUrl(urlInput)
    if (!parsed) {
      urlError = '无法解析链接，请输入有效的 GitHub 仓库 URL（如 https://github.com/owner/repo）'
      return
    }
    openRepo(parsed.owner, parsed.repo, { ref: parsed.branch, file: parsed.path })
    urlInput = ''
  }

  /** 数字格式化（star/fork）。 */
  function fmtNum(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  /** 仓库卡片（收藏 + 最近打开复用）。 */
  function repoCardKey(owner: string, repo: string): string {
    return `${owner}/${repo}`
  }
</script>

<div class="mx-auto flex min-h-0 flex-col gap-6 overflow-auto p-4 md:p-6">
  <!-- 1. 收藏仓库 -->
  <section>
    <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold">
      <StarIcon class="size-4" />
      收藏仓库
      {#if favorites.length > 0}
        <span class="text-muted-foreground text-xs">({favorites.length})</span>
      {/if}
    </h2>
    {#if initialLoading}
      <!-- 首屏骨架（store init 期间） -->
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each Array(6) as _}<Skeleton class="h-20" />{/each}
      </div>
    {:else if favorites.length === 0}
      <p class="text-muted-foreground py-4 text-center text-sm">
        暂无收藏。在 GithubApp 浏览仓库时点击星标即可收藏。
      </p>
    {:else if metaLoading && repoMeta.size === 0}
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each Array(Math.min(favorites.length, 6)) as _}<Skeleton class="h-20" />{/each}
      </div>
    {:else}
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each favorites as fav (fav.id)}
          {@const meta = repoMeta.get(repoCardKey(fav.owner, fav.repo))}
          <button
            type="button"
            onclick={() => openRepo(fav.owner, fav.repo)}
            class="border-border bg-card hover:bg-accent/50 flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors"
          >
            <span class="truncate font-mono text-sm font-medium">{fav.owner}/{fav.repo}</span>
            {#if meta?.description}
              <span class="text-muted-foreground line-clamp-2 text-xs">{meta.description}</span>
            {/if}
            <div class="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
              {#if meta && meta.stargazers_count > 0}
                <span class="inline-flex items-center gap-0.5">
                  <StarIcon class="size-3" />{fmtNum(meta.stargazers_count)}
                </span>
              {/if}
              {#if meta && meta.forks_count > 0}
                <span class="inline-flex items-center gap-0.5">
                  <GitForkIcon class="size-3" />{fmtNum(meta.forks_count)}
                </span>
              {/if}
              {#if meta?.language}
                <span>{meta.language}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 2. 链接输入（Card 组装） -->
  <section>
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-sm">
          <SearchIcon class="size-4" />
          打开仓库
        </Card.Title>
        <Card.Description>
          粘贴 GitHub 链接，支持完整 URL、<code class="font-mono">owner/repo</code> 短格式，可含分支和文件路径。
        </Card.Description>
      </Card.Header>
      <Card.Content class="flex gap-2">
        <input
          type="url"
          bind:value={urlInput}
          onkeydown={(e) => { if (e.key === 'Enter') handleOpenUrl() }}
          placeholder="https://github.com/owner/repo/tree/main/src"
          class="border-border bg-background focus:border-ring min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
        />
        <Button onclick={handleOpenUrl} disabled={!urlInput.trim()}>
          <ArrowRightIcon class="size-4" />
          <span class="hidden sm:inline">打开</span>
        </Button>
      </Card.Content>
      {#if urlError}
        <Card.Footer class="!pt-0">
          <p class="text-destructive text-xs">{urlError}</p>
        </Card.Footer>
      {/if}
    </Card.Root>
  </section>

  <!-- 3. 最近打开 -->
  {#if recents.length > 0}
    <section>
      <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ClockIcon class="size-4" />
        最近打开
        <span class="text-muted-foreground text-xs">({recents.length})</span>
      </h2>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each recents as r (r.id)}
          {@const meta = repoMeta.get(repoCardKey(r.owner, r.repo))}
          <button
            type="button"
            onclick={() => openRepo(r.owner, r.repo, { ref: r.branch, file: r.path })}
            class="border-border bg-card hover:bg-accent/50 flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors"
          >
            <span class="truncate font-mono text-sm font-medium">{r.owner}/{r.repo}</span>
            {#if meta?.description}
              <span class="text-muted-foreground line-clamp-1 text-xs">{meta.description}</span>
            {/if}
            <div class="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
              {#if r.branch}
                <span class="inline-flex items-center gap-0.5">
                  <GitForkIcon class="size-3" />{r.branch}
                </span>
              {/if}
              {#if r.path}
                <span class="truncate font-mono">{r.path}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>
