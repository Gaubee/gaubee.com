<!--
	JSON 查看器历史设置面板（设置页内联渲染，manifest.settingsSections 声明）。

	自定义历史记录的 IndexedDB 预算：单条上限 / 总预算（LRU）。
	历史数据本体在 IndexedDB（不占 localStorage）；设置元数据（几个数字）存 localStorage。
-->
<script lang="ts">
	import { onMount } from "svelte";
	import { DatabaseIcon, SaveIcon } from "@lucide/svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";

	import {
		readHistorySettings,
		writeHistorySettings,
		readHistory,
		clearHistory,
		type HistorySettings,
	} from "./json-viewer/history";
	import { createIdbHistoryStorage } from "./json-viewer/history-idb";

	const idb = createIdbHistoryStorage();
	let settings = $state<HistorySettings>({ ...readHistorySettings() });
	// 输入框用 MB 单位（用户语言），保存时换算字节
	let maxItemMb = $state(Math.round(settings.maxItemBytes / (1024 * 1024)));
	let maxTotalMb = $state(Math.round(settings.maxTotalBytes / (1024 * 1024)));
	let usage = $state<{ count: number; totalBytes: number } | null>(null);
	let saved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
		return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	async function refreshUsage(): Promise<void> {
		const items = await readHistory(idb);
		usage = { count: items.length, totalBytes: items.reduce((sum, i) => sum + i.bytes, 0) };
	}

	onMount(() => {
		void refreshUsage();
		return () => clearTimeout(savedTimer);
	});

	function handleSave(): void {
		settings = writeHistorySettings({
			maxItemBytes: maxItemMb * 1024 * 1024,
			maxTotalBytes: maxTotalMb * 1024 * 1024,
			maxItems: settings.maxItems,
		});
		maxItemMb = Math.round(settings.maxItemBytes / (1024 * 1024));
		maxTotalMb = Math.round(settings.maxTotalBytes / (1024 * 1024));
		saved = true;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (saved = false), 1500);
	}

	async function handleClear(): Promise<void> {
		await clearHistory(idb);
		await refreshUsage();
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-start gap-3">
		<DatabaseIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
		<div class="min-w-0 flex-1">
			<p class="text-sm">历史记录存储在浏览器 IndexedDB（不占用 localStorage），超出预算时从最旧记录开始淘汰。</p>
			<p class="mt-1 text-xs text-muted-foreground">
				当前占用：{usage ? `${usage.count} 条 · ${formatBytes(usage.totalBytes)}` : "统计中…"}
			</p>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<label class="flex flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">单条上限（MB，1–64）</span>
			<Input type="number" min={1} max={64} bind:value={maxItemMb} />
		</label>
		<label class="flex flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">总预算（MB，1–2048）</span>
			<Input type="number" min={1} max={2048} bind:value={maxTotalMb} />
		</label>
	</div>

	<div class="flex items-center gap-2">
		<Button size="sm" onclick={handleSave}>
			<SaveIcon class="size-3.5" />{saved ? "已保存" : "保存设置"}
		</Button>
		<Button size="sm" variant="ghost" class="text-destructive" onclick={() => void handleClear()}>
			清空历史
		</Button>
		{#if saved}
			<span class="text-xs text-muted-foreground">新预算对下一次记录生效（超预算的存量会被逐步淘汰）</span>
		{/if}
	</div>
</div>
