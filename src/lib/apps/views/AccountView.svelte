<!--
	AccountView：账户系统应用界面。
	参考 macOS「系统设置 → Apple ID / 账户」面板。

	- 登录态：头像、昵称、@login、刷新/登出
	- 未登录：登录引导（GitHub OAuth）
	- 账户身份说明、权限范围、会话安全

	注意：本视图只依赖 accountService（通过 gaubeeos），不直接 import authStore，
	也不依赖 SettingsApp。作为 /app/account 深链接视图呈现。
-->
<script lang="ts">
  import { gaubeeos } from '$lib/os/services'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/avatar'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import LogInIcon from '@lucide/svelte/icons/log-in'
  import LogOutIcon from '@lucide/svelte/icons/log-out'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check'
  import LockIcon from '@lucide/svelte/icons/lock'
  import KeyRoundIcon from '@lucide/svelte/icons/key-round'
  import { toast } from 'svelte-sonner'

  // 系统应用 account 始终可用；若意外不可用则降级为未登录
  const account = $derived(gaubeeos.getAppService('account'))
  const accountState = $derived(account?.state ?? { loaded: true, authenticated: false, user: null, error: null })
  let loggingOut = $state(false)
  let refreshing = $state(false)

  async function handleLogin() {
    account?.login()
  }

  async function handleLogout() {
    if (!account) return
    loggingOut = true
    try {
      await account.logout()
      toast.success('已登出')
    } finally {
      loggingOut = false
    }
  }

  async function handleRefresh() {
    if (!account) return
    refreshing = true
    try {
      await account.refresh()
    } finally {
      refreshing = false
    }
  }
</script>

<div class="mx-auto max-w-2xl p-6">
  <h1 class="mb-6 text-2xl font-semibold">账户</h1>

  <!-- 账户主体 -->
  <Card.Root>
    <Card.Header>
      <Card.Title>账户</Card.Title>
      <Card.Description>使用 GitHub 账户登录以编辑内容、提交变更。</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if !accountState.loaded}
        <div class="flex items-center gap-3">
          <Skeleton class="size-10 rounded-full" />
          <div class="flex flex-col gap-1.5">
            <Skeleton class="h-4 w-24" />
            <Skeleton class="h-3 w-32" />
          </div>
        </div>
      {:else if accountState.authenticated && accountState.user}
        <div class="flex items-center gap-3">
          <Avatar class="size-10">
            <AvatarImage src={accountState.user.avatar_url} alt={accountState.user.login} />
            <AvatarFallback>{accountState.user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{accountState.user.name ?? accountState.user.login}</div>
            <div class="text-muted-foreground truncate text-sm">@{accountState.user.login}</div>
          </div>
          <Button variant="outline" size="sm" onclick={handleRefresh} disabled={refreshing}>
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onclick={handleLogout} disabled={loggingOut}>
            <LogOutIcon data-icon="inline-start" />
            登出
          </Button>
        </div>
      {:else}
        <div class="flex flex-col items-start gap-3">
          <p class="text-muted-foreground text-sm">
            未登录。登录后可编辑文章、暂存变更并提交到 GitHub。
          </p>
          {#if accountState.error}
            <p class="text-destructive text-sm">{accountState.error}</p>
          {/if}
          <Button onclick={handleLogin}>
            <LogInIcon data-icon="inline-start" />
            用 GitHub 登录
          </Button>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- 登录身份与权限 -->
  <Card.Root class="mt-4">
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <LockIcon class="size-4" />
        登录方式
      </Card.Title>
    </Card.Header>
    <Card.Content>
      <div class="text-muted-foreground flex flex-col gap-2 text-sm">
        <p>通过 GitHub OAuth 登录。授权后，GaubeeOS 获得以下权限范围：</p>
        <ul class="ml-4 list-disc space-y-1">
          <li><code class="bg-muted rounded px-1 py-0.5 text-xs">repo</code> —— 读写关联仓库内容（用于编辑与发表）。</li>
          <li><code class="bg-muted rounded px-1 py-0.5 text-xs">user</code> —— 读取 GitHub 用户资料（昵称、头像）。</li>
        </ul>
        <p class="mt-2">如需撤销授权，可在 GitHub 账户的「授权应用」中移除。</p>
      </div>
    </Card.Content>
  </Card.Root>

  <!-- 会话安全 -->
  <Card.Root class="mt-4">
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <ShieldCheckIcon class="size-4" />
        会话安全
      </Card.Title>
    </Card.Header>
    <Card.Content>
      <div class="text-muted-foreground flex flex-col gap-2 text-sm">
        <div class="flex items-start gap-2">
          <KeyRoundIcon class="mt-0.5 size-4 shrink-0" />
          <p>访问令牌仅存储在服务端 httpOnly Cookie 中，前端代码无法读取，降低令牌泄露风险。</p>
        </div>
        <p>会话有效期约 30 天，期间无需重复登录。登出会立即清除服务端会话。</p>
      </div>
    </Card.Content>
  </Card.Root>
</div>
