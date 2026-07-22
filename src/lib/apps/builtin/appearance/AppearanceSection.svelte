<!--
	AppearanceSection：外观（主题）设置面板。
	作为设置页的内联 render section，提供明暗主题切换。
	复用 mode-watcher 的 mode/toggleMode，与桌面 StatusBar 的主题切换一致。
-->
<script lang="ts">
  import { mode, toggleMode } from 'mode-watcher'
  import SunIcon from '@lucide/svelte/icons/sun'
  import MoonIcon from '@lucide/svelte/icons/moon'
  import { Button } from '$lib/components/ui/button'
</script>

<div class="flex items-center gap-3">
  <Button variant="outline" size="sm" onclick={toggleMode}>
    {#if mode.current === 'dark'}
      <SunIcon data-icon="inline-start" />
      切换到亮色
    {:else}
      <MoonIcon data-icon="inline-start" />
      切换到暗色
    {/if}
  </Button>
  <span class="text-muted-foreground text-xs">
    当前：{mode.current === 'dark' ? '暗色' : '亮色'}
  </span>
</div>
