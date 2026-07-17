<!--
	SettingsView：设置页（阶段 3 实现登录/登出/用户信息）。
	后续阶段会加外观偏好、快捷键说明等。
-->
<script lang="ts">
  import { authStore } from '$lib/auth/session.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/avatar'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import LogInIcon from '@lucide/svelte/icons/log-in'
  import LogOutIcon from '@lucide/svelte/icons/log-out'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import { toast } from 'svelte-sonner'

  const authState = $derived(authStore.state)
  let loggingOut = $state(false)

  async function handleLogout() {
    loggingOut = true
    try {
      await authStore.logout()
      toast.success('已登出')
    } finally {
      loggingOut = false
    }
  }
</script>

<div class="mx-auto max-w-2xl p-6">
  <h1 class="mb-6 text-2xl font-semibold">设置</h1>

  <!-- 账户 / GitHub 登录 -->
  <Card.Root>
    <Card.Header>
      <Card.Title>账户</Card.Title>
      <Card.Description>使用 GitHub 账户登录以编辑内容、提交变更。</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if !authState.loaded}
        <div class="flex items-center gap-3">
          <Skeleton class="size-10 rounded-full" />
          <div class="flex flex-col gap-1.5">
            <Skeleton class="h-4 w-24" />
            <Skeleton class="h-3 w-32" />
          </div>
        </div>
      {:else if authState.authenticated && authState.user}
        <div class="flex items-center gap-3">
          <Avatar class="size-10">
            <AvatarImage src={authState.user.avatar_url} alt={authState.user.login} />
            <AvatarFallback>{authState.user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{authState.user.name ?? authState.user.login}</div>
            <div class="text-muted-foreground truncate text-sm">@{authState.user.login}</div>
          </div>
          <Button variant="outline" size="sm" onclick={() => authStore.refresh()}>
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
          {#if authState.error}
            <p class="text-destructive text-sm">{authState.error}</p>
          {/if}
          <Button onclick={() => authStore.login()}>
            <LogInIcon data-icon="inline-start" />
            用 GitHub 登录
          </Button>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- 后续：外观偏好、快捷键等 -->
  <Card.Root class="mt-4">
    <Card.Header>
      <Card.Title>关于</Card.Title>
    </Card.Header>
    <Card.Content>
      <p class="text-muted-foreground text-sm">
        Gaubee 编辑器 · 阶段 3（认证）。数据存于 GitHub 仓库，纯前端 + 边缘函数架构。
      </p>
    </Card.Content>
  </Card.Root>
</div>
