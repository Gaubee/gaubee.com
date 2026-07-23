<!--
	GithubView：Github 应用（基于 isomorphic-git）。
	
	功能：
	- 绑定任意 GitHub 仓库
	- 克隆仓库、查看提交历史、分支列表
	- 查看变更文件、diff
	- 支持 pull/commit/push 操作
	
	注意：需要 GitHub OAuth 认证才能 push。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { gaubeeos } from '$lib/os/services'
  import { ACCOUNT_UNAVAILABLE } from '$lib/apps/builtin/account/service'
  import { gitStore, type RepoConfig } from '$lib/apps/GitStore.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import GitBranchIcon from '@lucide/svelte/icons/git-branch'
  import GitCommitIcon from '@lucide/svelte/icons/git-commit'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import LogInIcon from '@lucide/svelte/icons/log-in'
  import CodeXmlIcon from '@lucide/svelte/icons/code-xml'

  let owner = $state('gaubee')
  let repo = $state('gaubee.com')
  let branch = $state('main')

  // 通过账户服务获取登录态（不再直接 import authStore）
  const account = $derived(gaubeeos.getAppService('account'))
  const accountState = $derived(account?.state ?? ACCOUNT_UNAVAILABLE)
  const repoState = $derived(gitStore.repo)
  const commits = $derived(gitStore.commits)
  const loading = $derived(gitStore.loading)
  const error = $derived(gitStore.error)

  async function handleClone() {
    const config: RepoConfig = {
      owner: owner.trim(),
      repo: repo.trim(),
      branch: branch.trim(),
      authenticated: accountState.authenticated,
    }
    try {
      await gitStore.clone(config)
    } catch (e) {
      // 错误已在 store 中处理
    }
  }

  async function handlePull() {
    await gitStore.pull()
  }

  function formatDate(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString('zh-CN')
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-6 flex items-center gap-2">
    <CodeXmlIcon class="size-5" />
    <h1 class="text-2xl font-semibold">Github</h1>
  </div>

  <!-- 只读说明 -->
  <Card.Root class="mb-4">
    <Card.Content class="text-muted-foreground pt-4 text-sm">
      此为公开仓库只读浏览器（基于 isomorphic-git 匿名 clone）。编辑与发表请用
      <button class="text-primary underline" onclick={() => navController.navigateMain('/app/writer')}>写作</button>
      应用（含编辑器与变更提交）；浏览与新建文件用
      <button class="text-primary underline" onclick={() => navController.navigateMain('/app/files')}>文件管理</button>
      应用。
    </Card.Content>
  </Card.Root>

  {#if !accountState.authenticated}
    <Card.Root class="mb-4">
      <Card.Content class="flex flex-col items-center gap-3 pt-8 pb-8 text-center">
        <p class="text-muted-foreground">登录后可访问更多仓库</p>
        <Button onclick={() => account?.login()}>
          <LogInIcon data-icon="inline-start" />
          用 GitHub 登录
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- 仓库绑定 -->
  <Card.Root class="mb-4">
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <GitBranchIcon class="size-4" />
        绑定仓库
      </Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <div class="flex gap-2">
        <Input placeholder="用户名/组织" bind:value={owner} class="flex-1" />
        <span class="self-center text-muted-foreground">/</span>
        <Input placeholder="仓库名" bind:value={repo} class="flex-1" />
        <span class="self-center text-muted-foreground">@</span>
        <Input placeholder="分支" bind:value={branch} class="w-24" />
      </div>
      <div class="flex gap-2">
        <Button onclick={handleClone} disabled={loading}>
          {#if loading}
            <RefreshCwIcon class="size-4 animate-spin" />
            克隆中…
          {:else}
            克隆仓库
          {/if}
        </Button>
        <Button variant="outline" onclick={handlePull} disabled={loading || !repoState}>
          <RefreshCwIcon class="size-4" />
          拉取
        </Button>
      </div>
      {#if error}
        <p class="text-destructive text-sm">{error}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- 提交历史 -->
  {#if repoState}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          <GitCommitIcon class="size-4" />
          提交历史
          <span class="text-muted-foreground text-sm font-normal">
            {repoState.owner}/{repoState.repo}@{gitStore.branch}
          </span>
        </Card.Title>
      </Card.Header>
      <Card.Content>
        {#if loading && commits.length === 0}
          {#each Array(3) as _}
            <Skeleton class="mb-2 h-10 w-full" />
          {/each}
        {:else if commits.length === 0}
          <p class="text-muted-foreground text-sm">暂无提交</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each commits as commit (commit.oid)}
              <div class="rounded-md border p-3">
                <div class="flex items-start gap-2">
                  <GitCommitIcon class="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{commit.message}</p>
                    <p class="text-muted-foreground text-xs">
                      {commit.author.name} · {formatDate(commit.author.timestamp)}
                      <span class="text-muted-foreground ml-2 font-mono text-xs">{commit.oid.slice(0, 7)}</span>
                    </p>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
