<!--
	RepoRefSelector：仓库 ref 选择器（branch/tag 下拉 + SHA 直跳）。

	设计意图（2026-07-27）：
	history tab 和 files tab 共用，用于切换浏览的 git ref。
	- 常驻触发按钮显示当前 ref（branch 名或 commit 短码）
	- Popover 展开：搜索框 + branch/tag 列表
	- 搜索框支持 SHA 直跳（输入 ≥7 位 hex 回车直接选中）

	数据懒加载：首次打开 Popover 时才请求 listBranches/listTags，
	避免进页面就发请求（很多用户不切换 ref）。

	状态机升级（2026-07-28）：branches/tags 合并为单一 resource（silent 失败，
	辅助数据用户可手输 SHA）。loaded 布尔由 status==='success' 替代。

	复用场景：
	- history tab：切换 branch 重新加载 commit 列表
	- files tab：切换 ref 重新加载文件树
-->
<script lang="ts">
  import { listBranches, listTags, type BranchSummary, type TagSummary } from '$lib/apps/installable/github/repo-api'
  import { createResource } from '$lib/apps/installable/github/state'
  import * as Popover from '$lib/components/ui/popover'
  import { Input } from '$lib/components/ui/input'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import GitBranchIcon from '@lucide/svelte/icons/git-branch'
  import TagIcon from '@lucide/svelte/icons/tag'
  import SearchIcon from '@lucide/svelte/icons/search'
  import CheckIcon from '@lucide/svelte/icons/check'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'

  type RefsData = { branches: BranchSummary[]; tags: TagSummary[] }

  let {
    owner,
    repo,
    currentRef,
    defaultBranch,
    onSelect,
  }: {
    owner: string
    repo: string
    /** 当前选中的 ref（branch 名 / tag 名 / commit SHA）。空表示默认分支。 */
    currentRef: string
    /** 仓库默认分支（如 main）。用于列表置顶 + 判断是否「历史版本」。 */
    defaultBranch: string
    /** 选择 ref 的回调（branch/tag/SHA 都走这个）。 */
    onSelect: (ref: string) => void
  } = $props()

  // Popover 开关
  let open = $state(false)

  // branch/tag 数据（懒加载，silent 失败：辅助数据，用户可手输 SHA）
  const refsResource = createResource(
    async (): Promise<RefsData> => {
      const [branches, tags] = await Promise.all([
        listBranches(owner, repo, { perPage: 100 }),
        listTags(owner, repo, { perPage: 100 }),
      ])
      return { branches, tags }
    },
    { silent: true, errorMessage: '加载分支失败' },
  )

  /** 是否已加载成功（替代原 loaded 布尔）。 */
  const loaded = $derived(refsResource.status === 'success')

  // 搜索词
  let search = $state('')

  /** 是否是 commit SHA（≥7 位 hex）。 */
  const isShaInput = $derived(/^[0-9a-f]{7,40}$/i.test(search.trim()))

  /** 当前已加载的 branches（未加载时为空数组）。 */
  const branches = $derived(refsResource.data?.branches ?? [])
  /** 当前已加载的 tags（未加载时为空数组）。 */
  const tags = $derived(refsResource.data?.tags ?? [])

  /** 过滤后的 branch 列表（默认分支置顶）。 */
  const filteredBranches = $derived(
    branches
      .filter((b) => !search.trim() || b.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        // 默认分支置顶
        if (a.name === defaultBranch) return -1
        if (b.name === defaultBranch) return 1
        return a.name.localeCompare(b.name)
      }),
  )

  /** 过滤后的 tag 列表。 */
  const filteredTags = $derived(
    tags.filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase())),
  )

  /** 显示的 ref 标签：SHA 截短为 7 位，否则原样。 */
  const displayRef = $derived(
    currentRef
      ? /^[0-9a-f]{7,40}$/i.test(currentRef) && currentRef.length > 12
        ? currentRef.slice(0, 7)
        : currentRef
      : defaultBranch,
  )

  /** 当前 ref 是否是 commit SHA（用于显示「历史版本」badge）。 */
  const isHistoricalRef = $derived(!!currentRef && currentRef !== defaultBranch)

  // 首次打开时懒加载 branch/tag
  $effect(() => {
    if (open && !loaded) {
      void refsResource.run()
    }
  })

  // 关闭时清空搜索
  $effect(() => {
    if (!open) search = ''
  })

  /** 选中某个 ref（branch/tag/SHA）。 */
  function handleSelect(ref: string) {
    onSelect(ref)
    open = false
  }

  /** 搜索框回车：SHA 直跳 或 选中第一个匹配。 */
  function handleSearchSubmit(e: Event) {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    if (isShaInput) {
      handleSelect(q)
      return
    }
    // 选中第一个匹配的 branch
    const first = filteredBranches[0] ?? filteredTags[0]
    if (first) handleSelect(first.name)
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="border-border bg-background hover:bg-accent inline-flex h-7 max-w-[200px] items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors"
    aria-label="切换 ref"
  >
    {#if isHistoricalRef}
      <GitBranchIcon class="text-primary size-3.5 shrink-0" />
    {:else}
      <GitBranchIcon class="text-muted-foreground size-3.5 shrink-0" />
    {/if}
    <span class="truncate font-mono">{displayRef}</span>
    <ChevronDownIcon class="text-muted-foreground size-3 shrink-0" />
  </Popover.Trigger>
  <Popover.Content class="w-72 p-0" align="start">
    <div class="border-border flex flex-col">
      <!-- 搜索框（同时过滤列表 + 接受 SHA 直跳） -->
      <div class="border-border p-2">
        <form onsubmit={handleSearchSubmit}>
          <div class="relative">
            <SearchIcon class="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              bind:value={search}
              placeholder="搜索 branch/tag 或输入 SHA"
              class="h-8 pl-7 text-xs"
            />
          </div>
        </form>
        {#if isShaInput}
          <p class="text-muted-foreground mt-1 text-[10px]">
            按 Enter 直达 commit {search.trim().slice(0, 7)}
          </p>
        {/if}
      </div>

      <!-- 列表区（可滚动） -->
      <div class="max-h-72 overflow-auto">
        {#if refsResource.isLoading && !loaded}
          <div class="space-y-1 p-2">
            {#each Array(4) as _}
              <Skeleton class="h-6 w-full" />
            {/each}
          </div>
        {:else}
          <!-- Branches -->
          {#if filteredBranches.length > 0}
            <div class="text-muted-foreground px-2 py-1 text-[10px] font-medium uppercase tracking-wide">
              Branches
            </div>
            {#each filteredBranches as b (b.name)}
              <button
                type="button"
                class="hover:bg-accent flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors"
                onclick={() => handleSelect(b.name)}
              >
                <GitBranchIcon class="text-muted-foreground size-3.5 shrink-0" />
                <span class="min-w-0 flex-1 truncate font-mono">{b.name}</span>
                {#if b.name === defaultBranch}
                  <span class="text-muted-foreground text-[10px]">default</span>
                {/if}
                {#if b.name === currentRef || (!currentRef && b.name === defaultBranch)}
                  <CheckIcon class="text-primary size-3.5 shrink-0" />
                {/if}
              </button>
            {/each}
          {/if}

          <!-- Tags -->
          {#if filteredTags.length > 0}
            <div class="text-muted-foreground mt-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide">
              Tags
            </div>
            {#each filteredTags as t (t.name)}
              <button
                type="button"
                class="hover:bg-accent flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors"
                onclick={() => handleSelect(t.name)}
              >
                <TagIcon class="text-muted-foreground size-3.5 shrink-0" />
                <span class="min-w-0 flex-1 truncate font-mono">{t.name}</span>
                {#if t.name === currentRef}
                  <CheckIcon class="text-primary size-3.5 shrink-0" />
                {/if}
              </button>
            {/each}
          {/if}

          {#if filteredBranches.length === 0 && filteredTags.length === 0 && !isShaInput}
            <p class="text-muted-foreground py-4 text-center text-xs">
              无匹配的 branch/tag
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </Popover.Content>
</Popover.Root>
