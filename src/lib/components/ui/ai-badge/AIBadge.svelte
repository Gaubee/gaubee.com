<!--
	AIBadge：AI 协作信息 badge（带 tooltip）。
	展示文章/说说使用的 AI Agent/Model 信息。
	用法：<AIBadge ai={["gpt-5.6-sol", "glm-5.2"]} />
-->
<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip'
  import SparklesIcon from '@lucide/svelte/icons/sparkles'

  let {
    ai,
    size = 'sm',
  }: {
    ai: string[]
    size?: 'sm' | 'xs'
  } = $props()

  const sizeClass = $derived(size === 'xs' ? 'text-[10px] px-1.5 py-0 h-5 font-normal' : 'text-xs')
</script>

<Tooltip.Provider>
  {#each ai as model (model)}
    <Tooltip.Root>
      <Tooltip.Trigger>
        <span class="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 {sizeClass} text-primary font-medium">
          <SparklesIcon class="size-3" />
          {model}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content side="top">
        <p class="text-xs">AI 协作：{model}</p>
        <p class="text-muted-foreground text-[10px]">本文由 AI 辅助创作</p>
      </Tooltip.Content>
    </Tooltip.Root>
  {/each}
</Tooltip.Provider>
