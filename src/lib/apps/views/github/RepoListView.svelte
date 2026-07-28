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
  import { onMount, onDestroy } from 'svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { useParams } from '$lib/router'
  import { accountService } from '$lib/apps/builtin/account/service'
  import { repoFavorites } from '$lib/apps/installable/github/favorites.svelte'
  import { listCache } from '$lib/apps/installable/github/list-cache.svelte'
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
  import { createResource } from '$lib/apps/installable/github/state'
  import GitHubMark from '$lib/components/icons/GitHubMark.svelte'
  import SearchIcon from '@lucide/svelte/icons/search'
  import StarIcon from '@lucide/svelte/icons/star'
  import GitForkIcon from '@lucide/svelte/icons/git-fork'
  import TagIcon from '@lucide/svelte/icons/tag'
  import UserIcon from '@lucide/svelte/icons/user'
  import BuildingIcon from '@lucide/svelte/icons/building-2'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import LoaderIcon from '@lucide/svelte/icons/loader-circle'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'

  // ---- 路由参数（2026-07-27 重构：useParams 返回 getter，需 $derived 包装）----
  // 旧 props listFilter 已删除；通过 useParams 拿到 'github.list.type' 的 {type}。
  // 首页（github root index）时 params 为 undefined → listFilter = null。
  // 分页列表（list/:type）时 params.type 作为 listFilter。
  type ListTypeParams = { type: string };
  const getParams = useParams<ListTypeParams>();
  const listFilter = $derived(getParams?.()?.type ?? null);

  // ---- 分页列表模式状态（从缓存读取，保持保活）----
  const filterCache = $derived(listFilter ? listCache.filters[listFilter] : undefined)
  let filterTitle = $state('')
  let filterLoading = $state(false)
  let filterError = $state<string | null>(null)
  /** 分页列表"加载更多"中。 */
  let filterLoadingMore = $state(false)
  /** 分页列表本地搜索词（客户端过滤已加载的 repos）。 */
  let filterSearchInput = $state('')
  /** 分页列表本地过滤后的 repos（按名称/描述模糊匹配）。 */
  const filteredRepos = $derived(
    filterCache && filterSearchInput.trim()
      ? filterCache.repos.filter((r) => {
          const q = filterSearchInput.toLowerCase()
          return (
            r.full_name.toLowerCase().includes(q) ||
            (r.description?.toLowerCase().includes(q) ?? false)
          )
        })
      : filterCache?.repos ?? [],
  )

  // ---- 账户状态 ----
  const accountState = $derived(accountService.state)
  const login = $derived(accountState.user?.login ?? null)

  // ---- 搜索（createResource 内置 seq 竞态，替代手写 searchSeq）----
  let searchInput = $state('')
  interface SearchResult { results: RepoSummary[]; total: number }
  const searchResource = createResource<SearchResult>(
    async () => {
      // 全局搜索 GitHub 仓库（不限定 user，覆盖 orgs + 全站）
      const { items, total } = await searchRepos(searchInput.trim(), { perPage: 30 })
      return { results: items, total }
    },
    { errorMessage: '搜索失败' },
  )
  /** 搜索结果（null=未搜索，[]=空结果）。 */
  const searchResults = $derived(
    searchResource.status === 'idle' ? null : (searchResource.data?.results ?? []),
  )
  /** 搜索总数。 */
  const searchTotal = $derived(searchResource.data?.total ?? 0)

  // ---- 聚合首页：从缓存读取（保活），首次/过期时后台刷新 ----
  const homeCache = $derived(listCache.home)
  const myRepos = $derived(homeCache?.myRepos ?? [])
  const myReposTotal = $derived(homeCache?.myReposTotal ?? 0)
  const orgs = $derived(homeCache?.orgs ?? [])
  const orgRepos = $derived(homeCache?.orgRepos ?? {})
  const orgReposTotal = $derived(homeCache?.orgReposTotal ?? {})
  let myReposLoading = $state(false)
  let myReposError = $state<string | null>(null)
  let orgsLoading = $state(false)

  // ---- 收藏（响应式）----
  const favorites = $derived(repoFavorites.items)

  const PREVIEW_COUNT = 3

  // listFilter 变化时加载分页列表（缓存命中则跳过）+ 重置本地搜索词
  $effect(() => {
    const f = listFilter
    filterSearchInput = ''
    if (f && !listCache.filters[f]) {
      void loadFilterList(true)
    }
  })

  /** 首次挂载或缓存为空时加载首页（缓存命中则跳过，保活）。 */
  onMount(() => {
    void repoFavorites.init()
    if (listFilter) {
      if (!listCache.filters[listFilter]) void loadFilterList(true)
    } else {
      // 首页：缓存命中直接用，过期或无缓存才刷新
      if (listCache.homeStale()) void loadMyData()
    }
  })

  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  /**
   * 分页列表模式：按 listFilter 加载第一页（reset=true）或下一页（reset=false）。
   * 缓存到 listCache.filters[listFilter]，组件重新挂载时从缓存读（保活）。
   */
  async function loadFilterList(reset: boolean) {
    if (!listFilter) return
    // 去重：同 key 已在加载中则跳过
    if (listCache.filterInFlight.has(listFilter)) return

    if (reset) {
      filterLoading = true
      filterError = null
    } else {
      filterLoadingMore = true
    }
    listCache.filterInFlight.add(listFilter)

    try {
      if (listFilter === 'favorites') {
        filterTitle = '收藏的仓库'
        const { getRepo } = await import('$lib/apps/installable/github/repo-api')
        await repoFavorites.init()
        const favs = repoFavorites.items
        const results = await Promise.all(
          favs.map((f) => getRepo(f.owner, f.repo).catch(() => null)),
        )
        const repos = results.filter((r): r is RepoSummary => r !== null)
        // 收藏无分页概念，一次性加载
        listCache.filters = {
          ...listCache.filters,
          [listFilter]: { title: '收藏的仓库', repos, total: repos.length, loadedPage: 1, hasMore: false },
        }
      } else if (listFilter.startsWith('user:')) {
        const username = listFilter.slice(5)
        filterTitle = `${username} 的仓库`
        const existing = listCache.filters[listFilter]
        const nextPage = reset ? 1 : (existing?.loadedPage ?? 0) + 1
        const PER_PAGE = 30
        const page = await listUserRepos({ perPage: PER_PAGE, page: nextPage })
        const repos = reset ? page.repos : [...(existing?.repos ?? []), ...page.repos]
        listCache.filters = {
          ...listCache.filters,
          [listFilter]: {
            title: filterTitle,
            repos,
            total: page.total || repos.length,
            loadedPage: nextPage,
            hasMore: page.hasMore,
          },
        }
      } else if (listFilter.startsWith('org:')) {
        const org = listFilter.slice(4)
        filterTitle = `${org} 的仓库`
        const existing = listCache.filters[listFilter]
        const nextPage = reset ? 1 : (existing?.loadedPage ?? 0) + 1
        const PER_PAGE = 30
        const page = await listOrgRepos(org, { perPage: PER_PAGE, page: nextPage })
        const repos = reset ? page.repos : [...(existing?.repos ?? []), ...page.repos]
        listCache.filters = {
          ...listCache.filters,
          [listFilter]: {
            title: filterTitle,
            repos,
            total: page.total || repos.length,
            loadedPage: nextPage,
            hasMore: page.hasMore,
          },
        }
      }
    } catch (e) {
      if (reset) filterError = e instanceof Error ? e.message : '加载列表失败'
    } finally {
      listCache.filterInFlight.delete(listFilter)
      filterLoading = false
      filterLoadingMore = false
    }
  }

  // 登录状态变化时重新加载个人数据（仅聚合首页模式 + 缓存过期时）
  $effect(() => {
    const currentLogin = login
    if (currentLogin && !listFilter && listCache.homeStale()) {
      void loadMyData()
    }
  })

  /**
   * 加载聚合首页数据（增量渲染：谁先回来谁先写缓存，触发渐进式显示）。
   * - myRepos 先回 → 先写 home（orgs 空），用户立即看到个人仓库
   * - orgs 列表回 → 更新 home（补 org 标题，org 仓库还空）
   * - 每个 org 的仓库回 → 增量更新 home.orgRepos（逐个 org 出现仓库卡片）
   */
  async function loadMyData() {
    if (!login) return
    if (listCache.homeInFlight) return
    listCache.homeInFlight = true
    myReposLoading = true
    myReposError = null
    orgsLoading = true
    const PER_PAGE = 30

    // 初始化空 home（已有则保留，渐进填充）
    const base = listCache.home ?? {
      myRepos: [],
      myReposTotal: 0,
      orgs: [],
      orgRepos: {},
      orgReposTotal: {},
      loadedAt: Date.now(),
    }

    // myRepos 与 orgs 列表并发，各自完成后立即写缓存（增量渲染）。
    // 注意：每次写入都要读当时的 listCache.home（而非函数开头的 base），
    // 避免并发完成顺序不同导致互相覆盖（如 repos 后完成时用旧 base 清掉 orgs）。
    const reposPromise = listUserRepos({ perPage: PER_PAGE })
      .then((page) => {
        const cur = listCache.home ?? base
        listCache.home = {
          ...cur,
          myRepos: page.repos,
          myReposTotal: page.total || page.repos.length,
          loadedAt: Date.now(),
        }
      })
      .catch((e) => {
        myReposError = e instanceof Error ? e.message : '加载仓库列表失败'
      })
      .finally(() => {
        myReposLoading = false
      })

    const orgsPromise = listUserOrgs()
      .then(async (userOrgs) => {
        // org 列表回来，先写 home（org 仓库还空，但标题出来了）
        const current = listCache.home ?? base
        listCache.home = {
          ...current,
          orgs: userOrgs,
          loadedAt: Date.now(),
        }
        orgsLoading = false
        // 并发拉每个 org 的仓库，每个回来就增量更新（独立 catch）
        for (const org of userOrgs) {
          listOrgRepos(org.login, { perPage: PER_PAGE })
            .then((page) => {
              const cur = listCache.home
              if (!cur) return
              listCache.home = {
                ...cur,
                orgRepos: { ...cur.orgRepos, [org.login]: page.repos },
                orgReposTotal: { ...cur.orgReposTotal, [org.login]: page.total || page.repos.length },
                loadedAt: Date.now(),
              }
            })
            .catch(() => {
              // 单个 org 仓库加载失败静默（保留标题，仓库为空）
            })
        }
      })
      .catch(() => {
        orgsLoading = false
      })

    await Promise.allSettled([reposPromise, orgsPromise])
    listCache.homeInFlight = false
  }

  /** 搜索 debounce timer（300ms，实时搜索）。 */
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  /** 实时搜索：输入时 debounce 300ms 自动触发。 */
  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      void handleSearch()
    }, 300)
  }

  async function handleSearch() {
    const q = searchInput.trim()
    if (!q) {
      // 清空搜索：reset 回 idle（searchResults 派生为 null）
      searchResource.reset()
      return
    }
    // createResource 内置 seq 竞态防护（替代手写 searchSeq），丢弃过期结果
    void searchResource.run()
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
      <h1 class="text-lg font-semibold">{filterCache?.title ?? filterTitle}</h1>
      {#if filterCache}
        <Badge variant="secondary" class="text-xs">{filterCache.total}</Badge>
      {/if}
    </div>
    {#if filterCache}
      <!-- 分页列表本地搜索（客户端过滤已加载 repos，实时无 debounce）-->
      <div class="relative">
        <SearchIcon class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          bind:value={filterSearchInput}
          placeholder="过滤已加载的仓库…"
          class="h-9 pl-8 text-sm"
        />
      </div>
    {/if}
    {#if filterLoading && !filterCache}
      <div class="space-y-2">
        {#each Array(6) as _}<Skeleton class="h-16 w-full" />{/each}
      </div>
    {:else if filterError && !filterCache}
      <p class="text-destructive text-sm">{filterError}</p>
    {:else if filteredRepos.length === 0 && filterCache}
      <p class="text-muted-foreground py-4 text-center text-sm">
        {filterSearchInput.trim() ? '无匹配仓库' : '暂无仓库'}
      </p>
    {:else if filterCache}
      {@render repoGrid(filteredRepos)}
      {#if filterCache.hasMore && !filterSearchInput.trim()}
        <button
          class="hover:bg-accent flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs"
          onclick={() => loadFilterList(false)}
          disabled={filterLoadingMore}
        >
          <ChevronDownIcon class="size-3.5 {filterLoadingMore ? 'animate-bounce' : ''}" />
          {filterLoadingMore ? '加载中…' : '加载更多'}
        </button>
      {:else if filterCache.repos.length > 10 && !filterSearchInput.trim()}
        <p class="text-muted-foreground py-2 text-center text-xs">已加载全部 {filterCache.repos.length} 个</p>
      {/if}
    {/if}
  {:else}
  <!-- 标题 + 搜索（实时搜索，debounce 300ms）-->
  <div class="flex flex-wrap items-center gap-3">
    <GitHubMark class="size-6" />
    <h1 class="text-2xl font-semibold">Github</h1>
    <div class="relative ml-auto w-full max-w-sm">
      <SearchIcon class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
      <Input
        bind:value={searchInput}
        placeholder="搜索仓库（支持 org/user 关键词）"
        class="pl-8"
        oninput={scheduleSearch}
      />
      {#if searchResource.isLoading}
        <LoaderIcon class="text-muted-foreground absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin" />
      {/if}
    </div>
  </div>

  <!-- 搜索结果（优先展示）-->
  {#if searchResults !== null}
    <div class="space-y-2">
      <div class="text-muted-foreground flex items-center gap-2 text-sm">
        <span>搜索结果（{searchTotal > 0 ? searchTotal : searchResults.length}）</span>
        <button
          class="text-primary hover:underline"
          onclick={() => {
            searchResource.reset()
            searchInput = ''
          }}
        >清除</button>
      </div>
      {#if searchResource.status === 'loading' || searchResource.status === 'refreshing'}
        {#each Array(3) as _}<Skeleton class="h-16" />{/each}
      {:else if searchResource.status === 'error'}
        <p class="text-destructive text-sm">{searchResource.error}</p>
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
        <TagIcon class="size-4 text-amber-500" />
        <h2 class="text-base font-medium">收藏的仓库</h2>
        <Badge variant="secondary" class="text-xs">{favorites.length}</Badge>
        {#if favoriteRepos.length > PREVIEW_COUNT}
          <button
            class="text-primary hover:bg-accent ml-auto flex items-center gap-0.5 rounded-md px-2 py-0.5 text-xs"
            onclick={() => navController.navigateMain('/app/github/list/favorites')}
          >
            查看全部 {favoriteRepos.length} 个
            <ChevronRightIcon class="size-3" />
          </button>
        {/if}
      </div>
      {#if favoritesLoading && favorites.length > 0}
        {#each Array(Math.min(favorites.length, PREVIEW_COUNT)) as _}<Skeleton class="h-16" />{/each}
      {:else if favorites.length === 0}
        <p class="text-muted-foreground rounded-lg border border-dashed py-6 text-center text-sm">
          还没有收藏的仓库。在仓库详情页点星标即可收藏。
        </p>
      {:else}
        {@render repoGrid(favoriteRepos.slice(0, PREVIEW_COUNT))}
      {/if}
    </section>

    {#if login}
      <!-- 我的仓库 -->
      <section class="space-y-2">
        <div class="flex items-center gap-2">
          <UserIcon class="size-4 text-muted-foreground" />
          <h2 class="text-base font-medium">{login} 的仓库</h2>
          <Badge variant="secondary" class="text-xs">{myReposTotal}</Badge>
          {#if myReposTotal > PREVIEW_COUNT}
            <button
              class="text-primary hover:bg-accent ml-auto flex items-center gap-0.5 rounded-md px-2 py-0.5 text-xs"
              onclick={() => navController.navigateMain(`/app/github/list/user:${login}`)}
            >
              查看全部 {myReposTotal} 个
              <ChevronRightIcon class="size-3" />
            </button>
          {/if}
        </div>
        {#if myReposLoading}
          {#each Array(PREVIEW_COUNT) as _}<Skeleton class="h-16" />{/each}
        {:else if myReposError}
          <p class="text-destructive text-sm">{myReposError}</p>
        {:else if myRepos.length === 0}
          <p class="text-muted-foreground text-sm">暂无仓库</p>
        {:else}
          {@render repoGrid(myRepos.slice(0, PREVIEW_COUNT))}
        {/if}
      </section>

      <!-- 各 org 仓库 -->
      {#if orgsLoading}
        <Skeleton class="h-24" />
      {:else}
        {#each orgs as org (org.login)}
          {@const repos = orgRepos[org.login] ?? []}
          {@const total = orgReposTotal[org.login] ?? repos.length}
          <section class="space-y-2">
            <div class="flex items-center gap-2">
              {#if org.avatar_url}
                <img src={org.avatar_url} alt={org.login} class="size-4 rounded-full" />
              {:else}
                <BuildingIcon class="size-4 text-muted-foreground" />
              {/if}
              <h2 class="text-base font-medium">{org.login} 的仓库</h2>
              <Badge variant="secondary" class="text-xs">{total}</Badge>
              {#if total > PREVIEW_COUNT}
                <button
                  class="text-primary hover:bg-accent ml-auto flex items-center gap-0.5 rounded-md px-2 py-0.5 text-xs"
                  onclick={() => navController.navigateMain(`/app/github/list/org:${org.login}`)}
                >
                  查看全部 {total} 个
                  <ChevronRightIcon class="size-3" />
                </button>
              {/if}
            </div>
            {#if repos.length === 0}
              <p class="text-muted-foreground text-sm">暂无仓库</p>
            {:else}
              {@render repoGrid(repos.slice(0, PREVIEW_COUNT))}
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
