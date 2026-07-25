<!--
	RepoListView：GithubApp 列表页（聚合卡片 + 搜索）。

	布局：
	- 顶部搜索框（searchRepos，默认限定 user:{login}，未登录则全局搜索）。
	- 收藏卡片（本地 repoFavorites，首页固定置顶）。
	- 我的仓库卡片（listUserRepos，登录后展示，最近 3 个）。
	- 各 org 仓库卡片（listUserOrgs → listOrgRepos，每 org 最近 3 个）。
	- 每张卡片支持「展开全部」→ 进入分页列表。

	状态保活：本组件由 GithubView（tabView，常驻 DOM）按 pathname 分发渲染，
	列表状态（滚动位置/展开）天然保活（display 切换不卸载组件实例）。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { accountService } from '$lib/apps/builtin/account/service'
  import { repoFavorites } from '$lib/apps/installable/github/favorites.svelte'
  import {
    listUserRepos,
    listUserOrgs,
    listOrgRepos,
    searchRepos,
    type RepoSummary,
    type OrgSummary,
  } from '$lib/apps/installable/github/repo-api'
  import { OWNER, REPO } from '$lib/github/client'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Badge } from '$lib/components/ui/badge'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import GitHubMark from '$lib/components/icons/GitHubMark.svelte'
  import SearchIcon from '@lucide/svelte/icons/search'
  import StarIcon from '@lucide/svelte/icons/star'
  import GitForkIcon from '@lucide/svelte/icons/git-fork'
  import PinIcon from '@lucide/svelte/icons/pin'
  import UserIcon from '@lucide/svelte/icons/user'
  import BuildingIcon from '@lucide/svelte/icons/building-2'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'

  // ---- props ----
  /**
   * 分页列表模式筛选条件。非 null 时进入分页列表模式（只渲染单一列表，不限 3 个）。
   * 格式：'favorites' | 'user:{login}' | 'org:{org}'
   */
  let { listFilter = null }: { listFilter?: string | null } = $props()

  // ---- 分页列表模式状态 ----
  let filterTitle = $state('')
  let filterRepos = $state<RepoSummary[]>([])
  let filterLoading = $state(false)
  let filterError = $state<string | null>(null)

  // ---- 账户状态 ----
  const accountState = $derived(accountService.state)
  const login = $derived(accountState.user?.login ?? null)

  // ---- 搜索 ----
  let searchInput = $state('')
  let searchResults = $state<RepoSummary[] | null>(null)
  let searchLoading = $state(false)
  let searchError = $state<string | null>(null)

  // ---- 我的仓库 ----
  let myRepos = $state<RepoSummary[]>([])
  let myReposLoading = $state(false)
  let myReposError = $state<string | null>(null)

  // ---- orgs ----
  let orgs = $state<OrgSummary[]>([])
  let orgRepos = $state<Record<string, RepoSummary[]>>({})
  let orgsLoading = $state(false)

  // ---- 收藏（响应式）----
  const favorites = $derived(repoFavorites.items)

  const PREVIEW_COUNT = 3

  onMount(() => {
    void repoFavorites.init()
    if (listFilter) {
      void loadFilterList()
    } else {
      void loadMyData()
    }
  })

  // listFilter 变化时重新加载分页列表
  $effect(() => {
    const f = listFilter
    if (f) void loadFilterList()
  })

  /** 分页列表模式：按 listFilter 加载单一列表（不限数量）。 */
  async function loadFilterList() {
    if (!listFilter) return
    filterLoading = true
    filterError = null
    filterRepos = []
    try {
      const { getRepo } = await import('$lib/apps/installable/github/repo-api')
      if (listFilter === 'favorites') {
        filterTitle = '收藏的仓库'
        // 等待 favorites init 完成
        await repoFavorites.init()
        const favs = repoFavorites.items
        const results = await Promise.all(
          favs.map((f) => getRepo(f.owner, f.repo).catch(() => null)),
        )
        filterRepos = results.filter((r): r is RepoSummary => r !== null)
      } else if (listFilter.startsWith('user:')) {
        const username = listFilter.slice(5)
        filterTitle = `${username} 的仓库`
        filterRepos = await listUserRepos({ perPage: 100 })
      } else if (listFilter.startsWith('org:')) {
        const org = listFilter.slice(4)
        filterTitle = `${org} 的仓库`
        filterRepos = await listOrgRepos(org, { perPage: 100 })
      }
    } catch (e) {
      filterError = e instanceof Error ? e.message : '加载列表失败'
    } finally {
      filterLoading = false
    }
  }

  // 登录状态变化时重新加载个人数据（仅聚合首页模式）
  $effect(() => {
    const currentLogin = login
    if (currentLogin && !listFilter) {
      void loadMyData()
    }
  })

  async function loadMyData() {
    if (!login) return
    myReposLoading = true
    myReposError = null
    try {
      const [repos, userOrgs] = await Promise.all([
        listUserRepos({ perPage: 30 }),
        listUserOrgs(),
      ])
      myRepos = repos
      orgs = userOrgs
      // 并发拉每个 org 的仓库（只拉前 30 个）
      const entries = await Promise.all(
        userOrgs.map(async (org) => [
          org.login,
          await listOrgRepos(org.login, { perPage: 30 }).catch(() => []),
        ] as const),
      )
      orgRepos = Object.fromEntries(entries)
    } catch (e) {
      myReposError = e instanceof Error ? e.message : '加载仓库列表失败'
    } finally {
      myReposLoading = false
      orgsLoading = false
    }
  }

  async function handleSearch() {
    const q = searchInput.trim()
    if (!q) {
      searchResults = null
      return
    }
    searchLoading = true
    searchError = null
    try {
      // 登录时默认限定到当前用户的仓库，否则全局搜索
      const query = login ? `${q} user:${login}` : q
      const { items } = await searchRepos(query, { perPage: 30 })
      searchResults = items
    } catch (e) {
      searchError = e instanceof Error ? e.message : '搜索失败'
      searchResults = []
    } finally {
      searchLoading = false
    }
  }

  function openRepo(owner: string, repo: string) {
    navController.navigateMain(`/app/github/repo/${owner}/${repo}`)
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso)
      const now = Date.now()
      const diff = now - d.getTime()
      const days = Math.floor(diff / 86400000)
      if (days < 1) return '今天'
      if (days < 30) return `${days} 天前`
      if (days < 365) return `${Math.floor(days / 30)} 个月前`
      return `${Math.floor(days / 365)} 年前`
    } catch {
      return iso
    }
  }

  function fmtNum(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  /** 收藏的仓库需要实时拉元数据（本地只存 owner/repo）。 */
  let favoriteRepos = $state<RepoSummary[]>([])
  let favoritesLoading = $state(false)
  $effect(() => {
    const favs = favorites
    if (favs.length === 0) {
      favoriteRepos = []
      return
    }
    favoritesLoading = true
    // 并发拉每个收藏仓库的元数据
    void (async () => {
      const { getRepo } = await import('$lib/apps/installable/github/repo-api')
      const results = await Promise.all(
        favs.map((f) => getRepo(f.owner, f.repo).catch(() => null)),
      )
      favoriteRepos = results.filter((r): r is RepoSummary => r !== null)
      favoritesLoading = false
    })()
  })
</script>

<div class="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
  {#if listFilter}
    <!-- 分页列表模式（展开全部）-->
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="icon-sm" onclick={() => navController.navigateMain('/app/github')} aria-label="返回">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <h1 class="text-lg font-semibold">{filterTitle}</h1>
      <Badge variant="secondary" class="text-xs">{filterRepos.length}</Badge>
    </div>
    {#if filterLoading}
      {#each Array(6) as _}<Skeleton class="h-16" />{/each}
    {:else if filterError}
      <p class="text-destructive text-sm">{filterError}</p>
    {:else if filterRepos.length === 0}
      <p class="text-muted-foreground py-4 text-center text-sm">暂无仓库</p>
    {:else}
      {@render repoGrid(filterRepos)}
    {/if}
  {:else}
  <!-- 标题 + 搜索 -->
  <div class="flex flex-wrap items-center gap-3">
    <GitHubMark class="size-6" />
    <h1 class="text-2xl font-semibold">Github</h1>
    <form
      class="ml-auto flex w-full max-w-sm items-center gap-1.5"
      onsubmit={(e) => {
        e.preventDefault()
        void handleSearch()
      }}
    >
      <div class="relative flex-1">
        <SearchIcon class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          bind:value={searchInput}
          placeholder={login ? `搜索 ${login} 的仓库` : '搜索仓库'}
          class="pl-8"
          onkeydown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
        />
      </div>
      <Button type="submit" size="sm" disabled={searchLoading}>
        {searchLoading ? '搜索中…' : '搜索'}
      </Button>
    </form>
  </div>

  <!-- 搜索结果（优先展示）-->
  {#if searchResults !== null}
    <div class="space-y-2">
      <div class="text-muted-foreground flex items-center gap-2 text-sm">
        <span>搜索结果（{searchResults.length}）</span>
        <button
          class="text-primary hover:underline"
          onclick={() => {
            searchResults = null
            searchInput = ''
          }}
        >清除</button>
      </div>
      {#if searchLoading}
        {#each Array(3) as _}<Skeleton class="h-16" />{/each}
      {:else if searchError}
        <p class="text-destructive text-sm">{searchError}</p>
      {:else if searchResults.length === 0}
        <p class="text-muted-foreground py-4 text-center text-sm">未找到匹配的仓库</p>
      {:else}
        {#each searchResults as r (r.id)}
          {@render repoCard(r)}
        {/each}
      {/if}
    </div>
  {:else}
    <!-- 收藏卡片（固定置顶）-->
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <PinIcon class="size-4 text-amber-500" />
        <h2 class="text-base font-medium">收藏的仓库</h2>
        <Badge variant="secondary" class="text-xs">{favorites.length}</Badge>
      </div>
      {#if favoritesLoading && favorites.length > 0}
        {#each Array(Math.min(favorites.length, PREVIEW_COUNT)) as _}<Skeleton class="h-16" />{/each}
      {:else if favorites.length === 0}
        <p class="text-muted-foreground rounded-lg border border-dashed py-6 text-center text-sm">
          还没有收藏的仓库。在仓库详情页点星标即可收藏。
        </p>
      {:else}
        {@render repoGrid(favoriteRepos.slice(0, PREVIEW_COUNT))}
        {#if favoriteRepos.length > PREVIEW_COUNT}
          <button
            class="text-primary hover:bg-accent w-full rounded-md py-1.5 text-center text-xs"
            onclick={() => navController.navigateMain('/app/github/list/favorites')}
          >
            查看全部 {favoriteRepos.length} 个 →
          </button>
        {/if}
      {/if}
    </section>

    {#if login}
      <!-- 我的仓库 -->
      <section class="space-y-2">
        <div class="flex items-center gap-2">
          <UserIcon class="size-4 text-muted-foreground" />
          <h2 class="text-base font-medium">{login} 的仓库</h2>
          <Badge variant="secondary" class="text-xs">{myRepos.length}</Badge>
        </div>
        {#if myReposLoading}
          {#each Array(PREVIEW_COUNT) as _}<Skeleton class="h-16" />{/each}
        {:else if myReposError}
          <p class="text-destructive text-sm">{myReposError}</p>
        {:else if myRepos.length === 0}
          <p class="text-muted-foreground text-sm">暂无仓库</p>
        {:else}
          {@render repoGrid(myRepos.slice(0, PREVIEW_COUNT))}
          {#if myRepos.length > PREVIEW_COUNT}
            <button
              class="text-primary hover:bg-accent w-full rounded-md py-1.5 text-center text-xs"
              onclick={() => navController.navigateMain(`/app/github/list/user:${login}`)}
            >
              查看全部 {myRepos.length} 个 →
            </button>
          {/if}
        {/if}
      </section>

      <!-- 各 org 仓库 -->
      {#if orgsLoading}
        <Skeleton class="h-24" />
      {:else}
        {#each orgs as org (org.login)}
          {@const repos = orgRepos[org.login] ?? []}
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              {#if org.avatar_url}
                <img src={org.avatar_url} alt={org.login} class="size-4 rounded-full" />
              {:else}
                <BuildingIcon class="size-4 text-muted-foreground" />
              {/if}
              <h2 class="text-base font-medium">{org.login} 的仓库</h2>
              <Badge variant="secondary" class="text-xs">{repos.length}</Badge>
            </div>
            {#if repos.length === 0}
              <p class="text-muted-foreground text-sm">暂无仓库</p>
            {:else}
              {@render repoGrid(repos.slice(0, PREVIEW_COUNT))}
              {#if repos.length > PREVIEW_COUNT}
                <button
                  class="text-primary hover:bg-accent w-full rounded-md py-1.5 text-center text-xs"
                  onclick={() => navController.navigateMain(`/app/github/list/org:${org.login}`)}
                >
                  查看全部 {repos.length} 个 →
                </button>
              {/if}
            {/if}
          </section>
        {/each}
      {/if}
    {:else if !accountState.loaded}
      <!-- 会话未确认：骨架 -->
      <Skeleton class="h-24" />
    {:else}
      <!-- 未登录提示 -->
      <div class="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        <p>登录 GitHub 后可查看你的仓库和组织。</p>
        <Button variant="outline" size="sm" class="mt-3" onclick={() => accountService.login()}>
          登录 GitHub
        </Button>
      </div>
    {/if}
  {/if}
  {/if}
</div>

<!-- 仓库卡片（单列）-->
{#snippet repoCard(r: RepoSummary)}
  <button
    class="hover:bg-accent flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors"
    onclick={() => openRepo(r.owner.login, r.name)}
  >
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-medium">{r.owner.login}/{r.name}</span>
        {#if r.archived}
          <Badge variant="outline" class="text-[10px]">归档</Badge>
        {/if}
        {#if r.owner.login === OWNER && r.name === REPO}
          <Badge variant="default" class="text-[10px]">主仓库</Badge>
        {/if}
      </div>
      {#if r.description}
        <p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{r.description}</p>
      {/if}
      <div class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-xs">
        {#if r.language}
          <span>{r.language}</span>
        {/if}
        <span class="flex items-center gap-0.5"><StarIcon class="size-3" />{fmtNum(r.stargazers_count)}</span>
        <span class="flex items-center gap-0.5"><GitForkIcon class="size-3" />{fmtNum(r.forks_count)}</span>
        <span>{formatTime(r.pushed_at)}更新</span>
      </div>
    </div>
    <ChevronRightIcon class="text-muted-foreground mt-1 size-4 shrink-0" />
  </button>
{/snippet}

<!-- 仓库卡片网格（3 列）-->
{#snippet repoGrid(repos: RepoSummary[])}
  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {#each repos as r (r.id)}
      {@render repoCard(r)}
    {/each}
  </div>
{/snippet}
