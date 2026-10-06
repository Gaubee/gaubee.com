<!--
	大 JSON 虚拟树：仅挂载滚动窗口内的行，数据量超过阈值时由 JsonViewerView 选择使用。
	纯扁平化和窗口计算在 virtual-tree.ts，组件只负责滚动与展开状态编排。
-->
<script lang="ts">
	import { onMount } from "svelte";

	import { valueTypeOf } from "./json-core";
	import type { JsonPathSegment } from "./query";
	import {
		containerPaths,
		flattenJsonTree,
		pathKey,
		visibleRange,
		type VirtualTreeRow,
	} from "./virtual-tree";

	interface Props {
		value: unknown;
		command?: { version: number; open: boolean };
		highlightPath?: readonly JsonPathSegment[] | null;
	}

	let { value, command = { version: 0, open: true }, highlightPath = null }: Props = $props();
	let openPaths = $state<Set<string>>(new Set([pathKey([])]));
	let scrollTop = $state(0);
	let viewportHeight = $state(360);
	let scrollEl: HTMLDivElement;
	let lastCommandVersion = 0;
	const ROW_HEIGHT = 26;

	const rows = $derived(flattenJsonTree(value, openPaths));
	const range = $derived(visibleRange(rows.length, scrollTop, viewportHeight, ROW_HEIGHT));
	const visibleRows = $derived(rows.slice(range.start, range.end));

	onMount(() => {
		if (!scrollEl) return;
		const updateHeight = () => (viewportHeight = scrollEl.clientHeight || 360);
		updateHeight();
		const observer = new ResizeObserver(updateHeight);
		observer.observe(scrollEl);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (command.version === 0 || command.version === lastCommandVersion) return;
		lastCommandVersion = command.version;
		openPaths = command.open
			? new Set(containerPaths(value))
			: new Set([pathKey([])]);
	});

	function toggle(row: VirtualTreeRow): void {
		if (!row.isContainer) return;
		const next = new Set(openPaths);
		if (next.has(row.pathKey)) next.delete(row.pathKey);
		else next.add(row.pathKey);
		openPaths = next;
	}

	function isHighlighted(row: VirtualTreeRow): boolean {
		return (
			highlightPath !== null &&
			highlightPath.length === row.path.length &&
			highlightPath.every((segment, index) => segment === row.path[index])
		);
	}

	function formatScalar(value: unknown, kind: ReturnType<typeof valueTypeOf>): string {
		if (kind === "string") return JSON.stringify(value);
		if (kind === "null") return "null";
		return String(value);
	}
</script>

<div
	class="jv-virtual-scroll"
	bind:this={scrollEl}
	onscroll={(event) => (scrollTop = (event.currentTarget as HTMLDivElement).scrollTop)}
	role="tree"
	aria-label="JSON 虚拟树"
>
	<div class="jv-virtual-spacer" style={`height: ${range.totalHeight}px`}>
		{#each visibleRows as row, index (row.pathKey)}
			{@const kind = row.kind}
			<div
				class:jv-highlight={isHighlighted(row)}
				class="jv-virtual-row"
				style={`top: ${(range.start + index) * ROW_HEIGHT}px; padding-left: ${row.depth * 1.25 + 0.25}rem`}
				role="treeitem"
				aria-level={row.depth + 1}
				aria-selected="false"
				aria-expanded={row.isContainer ? openPaths.has(row.pathKey) : undefined}
			>
				<button
					type="button"
					class="jv-virtual-toggle"
					disabled={!row.isContainer}
					onclick={() => toggle(row)}
					aria-label={row.isContainer ? (openPaths.has(row.pathKey) ? "收起" : "展开") : undefined}
				>
					<span class:open={openPaths.has(row.pathKey)} class="jv-chevron" aria-hidden="true">›</span>
				</button>
				{#if row.name !== null}<span class="jv-key">{row.name}</span><span class="jv-punct">:</span>{/if}
				{#if row.isContainer}
					<span class="jv-punct">{kind === "object" ? "{" : "["}</span>
					<span class="jv-count">{row.childCount}</span>
					{#if !openPaths.has(row.pathKey)}<span class="jv-punct">{kind === "object" ? "}" : "]"}</span>{/if}
				{:else}
					<span class={`jv-value jv-${kind}`}>{formatScalar(row.value, kind)}</span>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.jv-virtual-scroll {
		height: 100%;
		min-height: 0;
		overflow: auto;
		font-family: var(--font-mono, ui-monospace, monospace);
	}
	.jv-virtual-spacer {
		position: relative;
		min-width: max-content;
	}
	.jv-virtual-row {
		position: absolute;
		right: 0;
		left: 0;
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		height: 26px;
		padding-top: 0.05rem;
		padding-bottom: 0.05rem;
		padding-right: 0.25rem;
		border-radius: 0.25rem;
		font-size: 13px;
		line-height: 1.5;
		white-space: nowrap;
	}
	.jv-virtual-row:hover,
	.jv-highlight {
		background: color-mix(in oklch, var(--primary) 18%, transparent);
	}
	.jv-virtual-toggle {
		width: 0.875rem;
		flex-shrink: 0;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
	}
	.jv-virtual-toggle:disabled {
		cursor: default;
	}
	.jv-chevron {
		display: inline-block;
		transition: transform 120ms ease;
	}
	.jv-chevron.open {
		transform: rotate(90deg);
	}
	.jv-key {
		color: oklch(0.5 0.14 340);
	}
	.jv-punct {
		color: var(--muted-foreground);
	}
	.jv-count {
		border-radius: 9999px;
		background: color-mix(in oklch, var(--muted) 80%, transparent);
		padding: 0.125rem 0.3rem;
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.jv-value {
		white-space: pre;
	}
	.jv-string {
		color: oklch(0.45 0.11 150);
	}
	.jv-number {
		color: oklch(0.48 0.12 250);
	}
	.jv-boolean {
		color: oklch(0.5 0.13 55);
	}
	.jv-null {
		color: oklch(0.5 0.01 270);
		font-style: italic;
	}
	:global(.dark) .jv-key {
		color: oklch(0.76 0.12 340);
	}
	:global(.dark) .jv-string {
		color: oklch(0.74 0.12 150);
	}
	:global(.dark) .jv-number {
		color: oklch(0.75 0.11 250);
	}
	:global(.dark) .jv-boolean {
		color: oklch(0.78 0.12 55);
	}
	:global(.dark) .jv-null {
		color: oklch(0.62 0.01 270);
	}
</style>
