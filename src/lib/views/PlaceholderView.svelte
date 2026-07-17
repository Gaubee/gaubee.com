<!--
	通用占位视图：阶段 1 路由骨架用，显示当前 area location 与传入的 label。
	后续阶段会被真实功能 view 替换。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import type { Area } from '$lib/nav/controller'

  let {
    label,
    area,
  }: {
    label: string
    area: Area
  } = $props()

  const state = $derived(navStore.current)
  const location = $derived(
    area === 'main' ? state.mainLocation : area === 'bottom' ? state.bottomLocation : state.popLocation
  )
</script>

<div class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
  <div class="text-2xl font-semibold">{label}</div>
  <div class="text-muted-foreground text-sm">阶段 1 占位 · {area} 区</div>
  <code class="bg-muted mt-4 rounded px-2 py-1 text-xs">{location.pathname}{location.search}</code>
</div>
