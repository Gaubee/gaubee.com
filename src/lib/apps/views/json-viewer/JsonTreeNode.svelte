<!--
	JSON 树节点（递归组件）。

	设计：
	- 直接消费 JSON.parse 产物递归渲染，不预构建中间节点树（大 JSON 省一次遍历）。
	- 容器（对象/数组）折叠由本地 state 持有；「全部展开/收起」通过 command 版本号
	  广播（父组件递增 version，所有节点 $effect 响应对齐），避免逐层传递回调。
	- 类型着色用 oklch 双模式（浅/暗），跟随站点 .dark class；样式自治不进 app.css。
	- 长字符串截断展示（点击行内展开），截断基于原始 string 再 stringify，
	  不会把转义序列（\n、\uXXXX）拦腰截断。
-->
<script lang="ts" module>
	// 自导入（svelte:self 的 Svelte 5 官方替代），供递归渲染子节点
	import Self from "./JsonTreeNode.svelte";
</script>

<script lang="ts">
	import { ChevronRight } from "@lucide/svelte";

	import { valueTypeOf } from "./json-core";

	interface Props {
		/** 键名；根节点为 null。 */
		name?: string | null;
		value: unknown;
		defaultOpen?: boolean;
		/** 展开/收起广播：父组件递增 version 触发所有节点对齐到 open。 */
		command?: { version: number; open: boolean };
	}

	let {
		name = null,
		value,
		defaultOpen = true,
		command = { version: 0, open: true },
	}: Props = $props();

	let open = $state(defaultOpen);
	let stringExpanded = $state(false);

	$effect(() => {
		if (command.version > 0) open = command.open;
	});

	const kind = $derived(valueTypeOf(value));
	const entries = $derived.by<ReadonlyArray<readonly [string, unknown]> | null>(() => {
		if (kind === "object") return Object.entries(value as Record<string, unknown>);
		if (kind === "array") return (value as unknown[]).map((v, i) => [String(i), v] as const);
		return null;
	});
	const childCount = $derived(entries ? entries.length : 0);
	const isContainer = $derived(kind === "object" || kind === "array");
	const hasChildren = $derived(childCount > 0);

	const LONG_STRING = 120;
	const isLongString = $derived(kind === "string" && (value as string).length > LONG_STRING);
	const displayString = $derived.by(() => {
		if (kind !== "string") return "";
		const raw = value as string;
		return isLongString && !stringExpanded
			? JSON.stringify(raw.slice(0, LONG_STRING)).slice(1, -1)
			: JSON.stringify(raw).slice(1, -1);
	});
</script>

{#if isContainer && hasChildren}
	<div>
		<button
			type="button"
			class="jv-row jv-toggle"
			onclick={() => (open = !open)}
			aria-expanded={open}
		>
			<ChevronRight class={open ? "jv-chevron open" : "jv-chevron"} />
			{#if name !== null}<span class="jv-key">{name}</span><span class="jv-punct">:</span>{/if}
			<span class="jv-punct">{kind === "object" ? "{" : "["}</span>
			<span class="jv-count">{childCount}</span>
			{#if !open}<span class="jv-punct">{kind === "object" ? "}" : "]"}</span>{/if}
		</button>
		{#if open}
			<div class="jv-children">
				{#each entries as [k, v] (k)}
					<Self name={k} value={v} {defaultOpen} {command} />
				{/each}
			</div>
		{/if}
	</div>
{:else if isContainer}
	<!-- 空对象/空数组：内联展示，不可折叠 -->
	<div class="jv-row">
		<span class="jv-chevron-spacer"></span>
		{#if name !== null}<span class="jv-key">{name}</span><span class="jv-punct">:</span>{/if}
		<span class="jv-punct">{kind === "object" ? "{}" : "[]"}</span>
	</div>
{:else}
	<div class="jv-row">
		<span class="jv-chevron-spacer"></span>
		{#if name !== null}<span class="jv-key">{name}</span><span class="jv-punct">:</span>{/if}
		{#if kind === "string"}
			{#if isLongString}
				<button
					type="button"
					class="jv-str jv-str-toggle"
					onclick={() => (stringExpanded = !stringExpanded)}
					title={stringExpanded ? "点击收起" : "点击展开完整内容"}
				>
					"{displayString}"{#if !stringExpanded}<span class="jv-str-more">…</span>{/if}
				</button>
			{:else}
				<span class="jv-str">"{displayString}"</span>
			{/if}
		{:else if kind === "number"}
			<span class="jv-num">{String(value)}</span>
		{:else if kind === "boolean"}
			<span class="jv-bool">{String(value)}</span>
		{:else}
			<span class="jv-null">null</span>
		{/if}
	</div>
{/if}

<style>
	.jv-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-height: 1.375rem;
		padding: 0.05rem 0.25rem;
		border-radius: 0.25rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 13px;
		line-height: 1.5;
		text-align: left;
		width: 100%;
	}
	.jv-toggle {
		cursor: pointer;
		border: none;
		background: transparent;
		color: inherit;
	}
	.jv-row:not(.jv-toggle):hover {
		background: color-mix(in oklch, var(--muted) 40%, transparent);
	}
	.jv-toggle:hover {
		background: color-mix(in oklch, var(--muted) 55%, transparent);
	}
	/* lucide 图标是子组件，其根元素不携带本组件的 scope hash——
	   样式必须经 :global 后代选择器穿透（scoped .jv-chevron 对 svg 无效） */
	.jv-toggle :global(.jv-chevron) {
		width: 0.875rem;
		height: 0.875rem;
		flex-shrink: 0;
		align-self: center;
		color: var(--muted-foreground);
		transition: transform 120ms ease;
	}
	.jv-toggle :global(.jv-chevron.open) {
		transform: rotate(90deg);
	}
	.jv-chevron-spacer {
		display: inline-block;
		width: 0.875rem;
		flex-shrink: 0;
	}
	.jv-children {
		margin-left: 0.5625rem;
		border-left: 1px solid color-mix(in oklch, var(--border) 90%, transparent);
		padding-left: 0.75rem;
	}
	.jv-key {
		flex-shrink: 0;
		word-break: normal;
		overflow-wrap: anywhere;
		color: oklch(0.5 0.14 340);
	}
	.jv-punct {
		color: var(--muted-foreground);
	}
	.jv-count {
		font-size: 10px;
		line-height: 1;
		padding: 0.125rem 0.3rem;
		border-radius: 9999px;
		background: color-mix(in oklch, var(--muted) 80%, transparent);
		color: var(--muted-foreground);
	}
	.jv-str,
	.jv-num,
	.jv-bool,
	.jv-null {
		word-break: break-all;
		white-space: pre-wrap;
	}
	.jv-str {
		color: oklch(0.45 0.11 150);
	}
	.jv-str-toggle {
		cursor: pointer;
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
	}
	.jv-str-toggle:hover .jv-str-more {
		text-decoration: underline;
	}
	.jv-str-more {
		color: var(--muted-foreground);
		font-weight: 600;
	}
	.jv-num {
		color: oklch(0.48 0.12 250);
	}
	.jv-bool {
		color: oklch(0.5 0.13 55);
	}
	.jv-null {
		color: oklch(0.5 0.01 270);
		font-style: italic;
	}

	:global(.dark) .jv-key {
		color: oklch(0.76 0.12 340);
	}
	:global(.dark) .jv-str {
		color: oklch(0.74 0.12 150);
	}
	:global(.dark) .jv-num {
		color: oklch(0.75 0.11 250);
	}
	:global(.dark) .jv-bool {
		color: oklch(0.78 0.12 55);
	}
	:global(.dark) .jv-null {
		color: oklch(0.62 0.01 270);
	}
</style>
