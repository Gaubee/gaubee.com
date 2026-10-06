<!--
	流式行模型的窗口树。
	正交意图：1) 消费 Worker 事件形成的惰性行；2) TanStack 窗口渲染；3) 容器展开状态。
	原始需求（2026-10-06）：超大 JSON 不得把完整值复制到主线程。
-->
<script lang="ts">
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import type { StreamRow, StreamRowModel } from "./stream-rows";

	interface Props {
		model: StreamRowModel;
		command?: { version: number; open: boolean };
		version?: number;
	}

	let { model, command = { version: 0, open: true }, version = 0 }: Props = $props();
	let scrollEl: HTMLDivElement;
	let openIds = $state<Set<number>>(new Set());
	let lastCount = -1;
	let lastCommandVersion = 0;
	let defaultOpened = $state(false);
	const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => scrollEl,
		estimateSize: () => 26,
		overscan: 8,
	});
	const rows = $derived.by(() => {
		void version;
		return model.visibleCount(openIds);
	});

	$effect(() => {
		void version;
		if (!defaultOpened && model.size > 0) {
			const root = model.visibleRows(new Set(), 0, 1).rows[0];
			if (root && (root.childCount > 0 || (root.kind !== "object" && root.kind !== "array"))) {
				if (root.childCount > 0) openIds = new Set([root.id]);
				defaultOpened = true;
			}
		}
		if (command.version === 0 || command.version === lastCommandVersion) return;
		lastCommandVersion = command.version;
		openIds = command.open ? new Set(model.expandableIds()) : new Set();
	});

	$effect(() => {
		if (rows !== lastCount) {
			lastCount = rows;
			$virtualizer.setOptions({ count: rows });
		}
	});

	function toggle(rowId: number): void {
		const next = new Set(openIds);
		if (next.has(rowId)) next.delete(rowId);
		else next.add(rowId);
		openIds = next;
	}

	function toggleRow(row: StreamRow): void {
		if (row.aggregate) {
			const next = new Set(openIds);
			if (next.has(row.id)) next.delete(row.id);
			else next.add(row.id);
			const parentId = row.parentId;
			if (parentId !== null) {
				if (next.has(row.id)) next.add(parentId);
				else next.delete(parentId);
			}
			openIds = next;
			return;
		}
		toggle(row.id);
	}
</script>

	<div class="jv-stream-scroll jv-virtual-scroll" bind:this={scrollEl} role="tree" aria-label="JSON 流式树">
		<div class="jv-stream-spacer" style={`height: ${$virtualizer.getTotalSize()}px`}>
		{#each $virtualizer.getVirtualItems() as item (item.key)}
			{@const row = version >= 0 ? model.visibleRows(openIds, item.index, 1).rows[0] : undefined}
			{#if row}
					<div
						class="jv-stream-row jv-virtual-row"
					style={`transform: translateY(${item.start}px); padding-left: ${row.depth * 1.25 + 0.25}rem`}
					role="treeitem"
					aria-selected="false"
					aria-level={row.depth + 1}
					aria-expanded={row.childCount > 0 ? openIds.has(row.id) : undefined}
				>
					<button
						type="button"
						class="jv-stream-toggle"
						disabled={row.childCount === 0}
						onclick={() => toggleRow(row)}
						aria-label={row.childCount > 0 ? (openIds.has(row.id) ? "收起" : "展开") : undefined}
					>
						<span class:open={openIds.has(row.id)} class="jv-stream-chevron" aria-hidden="true">›</span>
					</button>
					{#if row.name !== null}<span class="jv-stream-key">{row.name}</span><span class="jv-stream-punct">:</span>{/if}
					{#if row.aggregate}
						<span class="jv-stream-count">{row.preview}</span>
					{:else if row.kind === "object" || row.kind === "array"}
						<span class="jv-stream-punct">{row.kind === "object" ? "{" : "["}</span>
						<span class="jv-stream-count">{row.childCount}</span>
					{:else}
						<span class={`jv-stream-value jv-stream-${row.kind}`}>{row.kind === "string" ? `"${row.preview}${row.skipped ? "…" : ""}"` : row.preview}</span>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.jv-stream-scroll { height: 100%; min-height: 0; overflow: auto; font-family: var(--font-mono, ui-monospace, monospace); }
	.jv-stream-spacer { position: relative; min-width: max-content; }
	.jv-stream-row { position: absolute; right: 0; left: 0; display: flex; align-items: baseline; gap: 0.375rem; height: 26px; padding-right: 0.25rem; font-size: 13px; line-height: 1.5; white-space: nowrap; }
	.jv-stream-row:hover { background: color-mix(in oklch, var(--primary) 18%, transparent); }
	.jv-stream-toggle { width: 0.875rem; flex-shrink: 0; border: 0; background: transparent; color: var(--muted-foreground); }
	.jv-stream-toggle:disabled { cursor: default; }
	.jv-stream-chevron { display: inline-block; transition: transform 120ms ease; }
	.jv-stream-chevron.open { transform: rotate(90deg); }
	.jv-stream-key { color: oklch(0.5 0.14 340); }
	.jv-stream-punct { color: var(--muted-foreground); }
	.jv-stream-count { border-radius: 9999px; background: color-mix(in oklch, var(--muted) 80%, transparent); padding: 0.125rem 0.3rem; font-size: 10px; color: var(--muted-foreground); }
	.jv-stream-string { color: oklch(0.45 0.11 150); }
	.jv-stream-number { color: oklch(0.48 0.12 250); }
	.jv-stream-boolean { color: oklch(0.5 0.13 55); }
	.jv-stream-null { color: oklch(0.5 0.01 270); font-style: italic; }
	:global(.dark) .jv-stream-key { color: oklch(0.76 0.12 340); }
	:global(.dark) .jv-stream-string { color: oklch(0.74 0.12 150); }
	:global(.dark) .jv-stream-number { color: oklch(0.75 0.11 250); }
	:global(.dark) .jv-stream-boolean { color: oklch(0.78 0.12 55); }
	:global(.dark) .jv-stream-null { color: oklch(0.62 0.01 270); }
</style>
