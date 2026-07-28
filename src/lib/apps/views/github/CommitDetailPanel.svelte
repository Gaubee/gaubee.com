<!--
	CommitDetailPanel：commit 详情面板（历史 Tab 右栏）。

	展示单个 commit 的完整信息（SHA/message/作者/parents/stats）+ files diff 列表。
	sha 变化时自动重新加载。

	状态机升级（2026-07-28）：commit 数据用 createResource 收口，header 和 files 区域
	各自用 AsyncBoundary 渲染（读同一 resource）。切换 SHA 时若已有旧 commit，进入 refreshing
	态保留旧数据（不再清空闪烁）。
-->
<script lang="ts">
  import { getCommit, type CommitDetail, type CommitFile } from '$lib/apps/installable/github/commit-api'
  import { parsePatch, type PatchLine } from '$lib/utils/patch-parser'
  import { createResource, AsyncBoundary } from '$lib/apps/installable/github/state'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import * as Tooltip from '$lib/components/ui/tooltip'
  // 图标
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import HistoryIcon from '@lucide/svelte/icons/history'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import { navController } from '$lib/nav/nav-controller-instance'

  let {
    sha,
    owner,
    repo,
    onopenhistorylist = () => {},
  }: {
    sha: string
    owner: string
    repo: string
    /** 移动端：打开历史 commit 列表浮层（桌面端不显示触发按钮）。 */
    onopenhistorylist?: () => void
  } = $props()

  /** 跳转到文件面板，按 commit ref 查看某文件的历史版本。 */
  function openFileAtCommit(fileSha: string, filePath: string) {
    const base = `/app/github/repo/${owner}/${repo}`
    navController.navigateMain(`${base}?tab=files&file=${encodeURIComponent(filePath)}&ref=${fileSha}`)
  }

  // commit 详情：单一 resource 驱动 header + files 区域
  const commitResource = createResource(
    () => getCommit(owner, repo, sha),
    { errorMessage: '加载 commit 失败' },
  )

  // 已展开全部 patch 的文件 filename 集合（默认仅显示前 PATCH_LINE_LIMIT 行）
  let expandedFiles = $state<Set<string>>(new Set())

  /** 单文件 patch 截断行数阈值。 */
  const PATCH_LINE_LIMIT = 200

  // commit SHA 前 7 位（短 SHA，便于展示）
  const shortSha = $derived(sha.slice(0, 7))

  // 父 commit 短 SHA 列表（依赖 resource.data，loading 时为空）
  const parentShortShas = $derived((commitResource.data?.parents ?? []).map((p) => p.slice(0, 7)))

  // sha 变化时重新加载。
  // createResource 的 fetcher 闭包内读取响应式 owner/repo/sha，run 时取最新值。
  // effect 内只依赖 sha（主键），owner/repo 在详情页内不变，无需触发重载。
  // reset 清空旧 commit：切换 SHA 时头部元数据（SHA/作者/时间）强相关当前 commit，
  // 保留旧数据会显示错误信息，应走骨架而非 refreshing。
  $effect(() => {
    const s = sha
    if (!s) return
    // 重置展开状态（新 commit 默认全部折叠）
    expandedFiles = new Set()
    commitResource.reset()
    void commitResource.run()
  })

  /** 切换某文件 patch 的展开/折叠状态 */
  function toggleExpand(filename: string) {
    const next = new Set(expandedFiles)
    if (next.has(filename)) {
      next.delete(filename)
    } else {
      next.add(filename)
    }
    expandedFiles = next
  }

  /** 文件状态 -> Badge 样式 + 中文标签映射 */
  const statusMeta: Record<CommitFile['status'], { label: string; class: string }> = {
    added: { label: '新增', class: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
    modified: { label: '修改', class: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    removed: { label: '删除', class: 'border-destructive/30 bg-destructive/10 text-destructive' },
    renamed: { label: '重命名', class: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400' },
    copied: { label: '复制', class: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400' },
    changed: { label: '变更', class: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    unchanged: { label: '未变', class: 'bg-muted text-muted-foreground' },
  }

  /**
   * 取某文件要渲染的 patch 行（截断 + 展开控制）。
   * - 未展开且行数 > PATCH_LINE_LIMIT：仅返回前 PATCH_LINE_LIMIT 行
   * - 已展开：返回全部行
   */
  function visiblePatchLines(file: CommitFile): PatchLine[] {
    const all = parsePatch(file.patch ?? '')
    if (expandedFiles.has(file.filename) || all.length <= PATCH_LINE_LIMIT) {
      return all
    }
    return all.slice(0, PATCH_LINE_LIMIT)
  }

  /** 格式化提交时间为相对友好的中文日期 */
  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '未知时间'
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
</script>

<!-- Tooltip.Provider 包裹整个面板：顶部 commit 外链 + 文件列表按钮共享 delay 配置。
     delayDuration=200ms（默认 700ms），让 tooltip 响应更及时。 -->
<Tooltip.Provider delayDuration={200}>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- 顶部 commit 元数据栏（由 AsyncBoundary 渲染状态分支） -->
    <header class="border-b border-border px-4 py-3">
      <AsyncBoundary resource={commitResource} skeletonCount={3} skeletonClass="mb-2 h-3 w-2/3">
        {#snippet skeleton()}
          <Skeleton class="mb-2 h-5 w-2/3" />
          <Skeleton class="mb-2 h-3 w-1/2" />
          <Skeleton class="h-3 w-1/3" />
        {/snippet}
        {#snippet children()}
          {@const commit = commitResource.data!}
          <!-- 工具栏：SHA + 标题 -->
          <div class="mb-2 flex items-start gap-2">
            <!-- 移动端：历史列表触发按钮（桌面端隐藏） -->
            <Button size="sm" variant="default" class="md:hidden" onclick={onopenhistorylist} aria-label="打开历史列表">
              <HistoryIcon class="size-4" />
            </Button>
            <GitCommitHorizontalIcon class="text-muted-foreground mt-0.5 size-4 shrink-0 max-md:hidden" />
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex items-center gap-2">
                <code class="text-muted-foreground font-mono text-xs">{shortSha}</code>
              </div>
              <h2 class="min-w-0 break-words text-sm font-semibold leading-snug">
                {commit.message}
              </h2>
            </div>
            <!-- GitHub 外链 -->
            <a
              href={commit.html_url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-6 items-center justify-center rounded transition-colors"
              aria-label="在 GitHub 查看"
              title="在 GitHub 查看 commit"
            >
              <ExternalLinkIcon class="size-3.5" />
            </a>
          </div>

          <!-- 作者 + 时间 -->
          <div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-2 text-xs">
            {#if commit.avatarUrl}
              <img
                src={commit.avatarUrl}
                alt={commit.login ?? commit.author?.name ?? ''}
                class="size-4 rounded-full"
                loading="lazy"
              />
            {/if}
            {#if commit.login}
              <span class="font-medium text-foreground">{commit.login}</span>
            {:else if commit.author?.name}
              <span class="font-medium text-foreground">{commit.author.name}</span>
            {/if}
            <span>· {formatDate(commit.author?.date ?? commit.committer?.date)}</span>
          </div>

          <!-- parents -->
          {#if parentShortShas.length > 0}
            <div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span class="inline-flex items-center gap-1">
                <GitCommitHorizontalIcon class="size-3" />
                父提交：
              </span>
              {#each parentShortShas as p, i}
                {#if i > 0}<span class="opacity-50">←</span>{/if}
                <code class="font-mono text-[11px]">{p}</code>
              {/each}
            </div>
          {/if}

          <!-- 统计栏：+N 增 / -M 删 -->
          {#if commit.stats}
            <div class="flex items-center gap-3 text-xs">
              <span class="font-medium text-emerald-600 dark:text-emerald-400">+{commit.stats.additions}</span>
              <span class="font-medium text-destructive">-{commit.stats.deletions}</span>
              <span class="text-muted-foreground">· {commit.files.length} 个文件</span>
            </div>
          {/if}
        {/snippet}
      </AsyncBoundary>
    </header>

    <!-- 中间：files diff 列表（可滚动）。同一 resource，但独立渲染分支（files 区有自己的空态）。 -->
    <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
      <AsyncBoundary resource={commitResource} skeletonCount={3} skeletonClass="h-24 w-full">
        {#snippet skeleton()}
          <div class="space-y-3">
            {#each Array(3) as _, i (i)}
              <Skeleton class="h-24 w-full" />
            {/each}
          </div>
        {/snippet}
        {#snippet children()}
          {@const commit = commitResource.data!}
          {#if commit.files.length === 0}
            <p class="text-muted-foreground py-8 text-center text-sm">该 commit 没有文件变更信息</p>
          {:else}
            <div class="space-y-3">
              {#each commit.files as file (file.filename)}
                {@const lines = parsePatch(file.patch ?? '')}
                {@const visible = visiblePatchLines(file)}
                {@const meta = statusMeta[file.status] ?? statusMeta.modified}
                {@const canBefore = !!(commit && commit.parents.length > 0 && file.status !== 'added')}
                {@const canAfter = file.status !== 'removed'}
                <Card.Root class="overflow-hidden">
                  <!-- 文件行：单行紧凑布局（参考 GitHub PR diff 文件行）。
                       左：状态 Badge + 文件路径（renamed 附带旧路径）
                       右：+/- 统计 + 操作组（变更前/变更后/GitHub 外链） -->
                  <Card.Header class="flex flex-row items-center gap-2 !py-2">
                    <Badge variant="outline" class="shrink-0 text-[10px] {meta.class}">
                      {meta.label}
                    </Badge>
                    <code class="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={file.filename}>
                      {file.filename}
                    </code>
                    {#if file.status === 'renamed' && file.previous_filename}
                      <span class="text-muted-foreground hidden shrink-0 text-[11px] sm:inline" title={file.previous_filename}>
                        ← <code class="font-mono">{file.previous_filename}</code>
                      </span>
                    {/if}

                    <!-- 右侧操作组：统计 + 分隔 + 跳转按钮 + 外链 -->
                    <div class="text-muted-foreground flex shrink-0 items-center gap-2 text-[11px]">
                      <!-- +/- 统计 -->
                      <span class="font-mono tabular-nums">
                        <span class="font-medium text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                        <span class="ml-0.5 font-medium text-destructive">-{file.deletions}</span>
                      </span>
                      <!-- 分隔线 -->
                      {#if canBefore || canAfter}
                        <span class="bg-border h-3 w-px"></span>
                      {/if}
                      <!-- 应用内文件跳转：在文件面板按 commit ref 查看历史版本。
                           变更前：parent commit 版本（renamed 用 previous_filename）
                           变更后：当前 commit 版本。
                           icon-only ghost 按钮，hover 高亮，title 提供完整说明。 -->
                      {#if canBefore}
                        <Tooltip.Root>
                          <Tooltip.Trigger
                            onclick={() => openFileAtCommit(commit.parents[0], file.previous_filename ?? file.filename)}
                            class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-5 items-center justify-center rounded transition-colors"
                            aria-label="查看变更前"
                          >
                            <ArrowLeftIcon class="size-3" />
                          </Tooltip.Trigger>
                          <Tooltip.Content>查看变更前（parent 版本）</Tooltip.Content>
                        </Tooltip.Root>
                      {/if}
                      {#if canAfter}
                        <Tooltip.Root>
                          <Tooltip.Trigger
                            onclick={() => openFileAtCommit(commit.sha, file.filename)}
                            class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-5 items-center justify-center rounded transition-colors"
                            aria-label="查看变更后"
                          >
                            <FileTextIcon class="size-3" />
                          </Tooltip.Trigger>
                          <Tooltip.Content>查看变更后（当前版本）</Tooltip.Content>
                        </Tooltip.Root>
                      {/if}
                      <span class="bg-border h-3 w-px"></span>
                      <!-- GitHub 外链 -->
                      <a
                        href={file.blob_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-5 items-center justify-center rounded transition-colors"
                        aria-label="在 GitHub 查看文件"
                        title="在 GitHub 查看"
                      >
                        <ExternalLinkIcon class="size-3" />
                      </a>
                    </div>
                  </Card.Header>
                  <Card.Content class="!px-0 !pb-0">
                    {#if file.patch === null}
                      {#if file.status === 'renamed' || file.status === 'copied'}
                        <!-- 纯移动/复制：patch 为 null 是正常的（无内容变更） -->
                        <p class="text-muted-foreground px-4 py-3 text-xs italic">
                          文件{file.status === 'renamed' ? '移动' : '复制'}（无内容变更）
                        </p>
                      {:else}
                        <!-- patch 为 null：文件变更超 300 行，GitHub API 不返回 diff -->
                        <div class="px-4 py-3">
                          <p class="text-muted-foreground text-xs italic">
                            变更行数较多（{file.additions + file.deletions} 行），GitHub API 未返回 diff
                          </p>
                        </div>
                      {/if}
                    {:else if lines.length === 0}
                      <p class="text-muted-foreground px-4 py-3 text-xs italic">无 diff 内容</p>
                    {:else}
                      <!-- patch 逐行渲染 -->
                      <div class="overflow-x-auto">
                        {#each visible as line}
                          <div
                            class="flex font-mono text-xs {line.type === 'add'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : line.type === 'del'
                                ? 'bg-destructive/10 text-destructive'
                                : line.type === 'hunk-header'
                                  ? 'bg-muted text-muted-foreground'
                                  : ''}"
                          >
                            <span class="w-6 shrink-0 select-none pr-1 text-right opacity-50">
                              {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                            </span>
                            <span class="whitespace-pre-wrap break-all">{line.text}</span>
                          </div>
                        {/each}
                      </div>
                      <!-- 大 patch 截断：展开全部按钮 -->
                      {#if lines.length > PATCH_LINE_LIMIT}
                        <div class="border-t border-border px-4 py-2">
                          {#if expandedFiles.has(file.filename)}
                            <Button variant="ghost" size="sm" class="w-full text-xs" onclick={() => toggleExpand(file.filename)}>
                              收起（共 {lines.length} 行）
                            </Button>
                          {:else}
                            <Button variant="ghost" size="sm" class="w-full text-xs" onclick={() => toggleExpand(file.filename)}>
                              展开全部（已显示 {PATCH_LINE_LIMIT} / {lines.length} 行）
                            </Button>
                          {/if}
                        </div>
                      {/if}
                    {/if}
                  </Card.Content>
                </Card.Root>
              {/each}
            </div>
          {/if}
        {/snippet}
      </AsyncBoundary>
    </div>
  </div>
</Tooltip.Provider>
