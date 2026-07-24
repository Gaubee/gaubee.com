<!--
	SettingsView：设置页（仅设置面板入口）。

	解耦设计：功能面板通过 settingsSectionsRegistry 注册，SettingsView 遍历
	registry.all() 动态渲染入口。谁提供能力谁注册入口，设置应用不反向依赖具体业务应用。

	应用管理（安装/卸载）已抽离到独立的「应用市场」应用（/app/store）。
-->
<script lang="ts">
  import { settingsSectionsRegistry, type SettingsSection } from '$lib/apps/builtin/settings-sections'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import StoreIcon from '@lucide/svelte/icons/store'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'

  const sections = $derived(settingsSectionsRegistry.all())

  function handleSectionClick(section: SettingsSection) {
    if (section.link) {
      navController.navigateMain(section.link)
    }
  }
</script>

<div class="mx-auto max-w-2xl p-6">
  <h1 class="mb-6 text-2xl font-semibold">设置</h1>

  <!-- 已注册的设置面板入口（账户、外观、关于等由各应用自行注册） -->
  {#if sections.length > 0}
    <Card.Root>
      <Card.Content class="flex flex-col gap-1 pt-2">
        {#each sections as section (section.id)}
          {#if section.render}
            <!-- 内联渲染型面板 -->
            <div class="border-b border-border py-3 last:border-b-0">
              <div class="mb-2 flex items-center gap-2">
                {#if section.icon}
                  <!-- svelte-ignore ownership_invalid_mutation -->
                  <section.icon class="text-muted-foreground size-4" />
                {/if}
                <span class="font-medium text-sm">{section.title}</span>
              </div>
              {#if section.description}
                <p class="text-muted-foreground mb-2 text-xs">{section.description}</p>
              {/if}
              <section.render />
            </div>
          {:else}
            <!-- 跳转型入口 -->
            <button
              class="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-3 text-left transition-colors"
              onclick={() => handleSectionClick(section)}
            >
              {#if section.icon}
                <!-- svelte-ignore ownership_invalid_mutation -->
                <section.icon class="text-muted-foreground size-4" />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="font-medium text-sm">{section.title}</div>
                {#if section.description}
                  <div class="text-muted-foreground truncate text-xs">{section.description}</div>
                {/if}
              </div>
              <ChevronRightIcon class="text-muted-foreground size-4" />
            </button>
          {/if}
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- 应用市场入口 -->
  <Card.Root class="mt-4">
    <Card.Content class="pt-4">
      <button
        class="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors"
        onclick={() => navController.openApp('/app/store')}
      >
        <StoreIcon class="text-muted-foreground size-4" />
        <div class="flex-1">
          <div class="font-medium text-sm">应用市场</div>
          <div class="text-muted-foreground text-xs">安装、卸载应用</div>
        </div>
        <ChevronRightIcon class="text-muted-foreground size-4" />
      </button>
    </Card.Content>
  </Card.Root>
</div>
