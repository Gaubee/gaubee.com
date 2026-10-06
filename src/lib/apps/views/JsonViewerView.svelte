<!--
	JSON 查看器视图（osapp: json-viewer）。

	渐进披露：默认路径只有「粘贴 → 看树」；工具栏按钮全部带 title tooltip，
	初级用户可以无视高级能力而不受干扰。纯逻辑在 ./json-viewer/json-core.ts
	（server project 可测），本组件只做编排。文件拖入监听 window（全窗口命中，
	用户无需瞄准输入区）。
-->
<script lang="ts">
 import { onDestroy, onMount } from "svelte";
	import {
		AlignLeft,
		ArrowLeftRight,
		ChevronsDownUp,
		ChevronsUpDown,
		Copy,
		CopyCheck,
		FileJson,
		GitCompareArrows,
		History,
		Minimize2,
		Search,
		Trash2,
	} from "@lucide/svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import * as Tabs from "$lib/components/ui/tabs";
	import CodeMirror from "$lib/editor/CodeMirror.svelte";
	import { copyText } from "$lib/utils/clipboard";

	import { buildStats, EXAMPLE_JSON, parseJson, type ParseOutcome } from "./json-viewer/json-core";
	import JsonTreeNode from "./json-viewer/JsonTreeNode.svelte";
	import JsonVirtualTree from "./json-viewer/JsonVirtualTree.svelte";
	import { diffJson, type JsonDiffEntry } from "./json-viewer/diff";
	import { readHistory, recordHistory, type JsonHistoryItem } from "./json-viewer/history";
	import { formatJsonPath, queryJson, type QueryMatch, type QueryOutcome } from "./json-viewer/query";
	import { inferJsonSchema, inferTypeScript, jsonToYaml, yamlToJson } from "./json-viewer/transform";
	import { shortcutAction } from "./json-viewer/shortcuts";

	// ---- 状态 ----
	let inputText = $state("");
	/** 程序化写回计数：变化时 CodeMirror 重载 doc（用户打字时不回写，避免反馈循环）。 */
	let docVersion = $state(0);
	/** 防抖解析结果（text 与值同源，防 250ms 间隙内输入变化的错位）。 */
	let parsed = $state<{ text: string; outcome: ParseOutcome } | null>(null);
	let parseSeq = $state(0);
	let view = $state<"tree" | "preview">("tree");
	/** 树展开/收起广播（version 递增触发所有节点对齐）。 */
	let treeCommand = $state({ version: 0, open: true });
	let copied = $state(false);
	let queryOpen = $state(false);
	let queryText = $state("$");
	let queryResult = $state<QueryOutcome | null>(null);
	let selectedQueryIndex = $state(0);
	let queryExtracted = $state<QueryMatch | null>(null);
	let transformOpen = $state(false);
	let transformMode = $state<"yaml" | "json" | "typescript" | "schema">("yaml");
	let transformOutput = $state("");
	let transformError = $state("");
	let yamlSource = $state("");
	let diffOpen = $state(false);
	let diffLeft = $state("");
	let diffRight = $state("");
	let diffResult = $state<JsonDiffEntry[] | null>(null);
	let diffError = $state("");
	let historyOpen = $state(false);
	let historyItems = $state<JsonHistoryItem[]>([]);
	let dragDepth = $state(0);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		if (typeof localStorage !== "undefined") historyItems = readHistory(localStorage);
	});

	// ---- 防抖解析（spec R2：≤300ms）----
	$effect(() => {
		const text = inputText;
		if (text.trim() === "") {
			parsed = null;
			return;
		}
		const timer = setTimeout(() => {
			parsed = { text, outcome: parseJson(text) };
			parseSeq += 1;
		}, 250);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const current = parsed;
		if (!current?.outcome.ok || typeof localStorage === "undefined") return;
		historyItems = recordHistory(localStorage, current.text);
	});

	/** 解析成功的聚合（值 + 对应文本），供树/预览/统计同源消费。 */
	const okResult = $derived.by<{ text: string; value: unknown } | null>(() => {
		const p = parsed;
		if (!p || !p.outcome.ok) return null;
		return { text: p.text, value: p.outcome.value };
	});
	const parseError = $derived.by(() => {
		const p = parsed;
		return p && !p.outcome.ok ? p.outcome.error : null;
	});
	const stats = $derived(okResult ? buildStats(okResult.value, okResult.text) : null);
	const selectedQueryMatch = $derived(
		queryResult?.ok ? (queryResult.matches[selectedQueryIndex] ?? null) : null,
	);
	const displayValue = $derived(queryExtracted?.value ?? okResult?.value ?? null);
	const useVirtualTree = $derived(stats ? stats.nodeCount > 5000 : false);
	/** 大 JSON（>2000 节点）默认只展开第一层，防渲染雪崩；展开交给用户。 */
	const defaultOpen = $derived(stats ? stats.nodeCount <= 2000 : true);
	const topTypeName = $derived.by(() => {
		if (!stats) return "";
		return {
			object: "对象",
			array: "数组",
			string: "字符串",
			number: "数字",
			boolean: "布尔",
			null: "null",
		}[stats.topType];
	});

	// ---- 动作 ----
	function replaceInput(text: string): void {
		inputText = text;
		docVersion += 1;
		queryResult = null;
		queryExtracted = null;
	}
	function handleInput(text: string): void {
		inputText = text;
		queryResult = null;
		queryExtracted = null;
	}
	function format(): void {
		if (okResult) replaceInput(JSON.stringify(okResult.value, null, 2));
	}
	function minify(): void {
		if (okResult) replaceInput(JSON.stringify(okResult.value));
	}
	async function copyInput(): Promise<void> {
		if (!inputText) return;
		try {
			await copyText(inputText);
			copied = true;
			clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = false), 1500);
		} catch {
			// 剪贴板不可用（权限/非安全上下文）：静默失败，数据在输入区可见可手动复制
		}
	}
	function collapseAll(): void {
		treeCommand = { version: treeCommand.version + 1, open: false };
	}
	function expandAll(): void {
		treeCommand = { version: treeCommand.version + 1, open: true };
	}
	function loadExample(): void {
		replaceInput(EXAMPLE_JSON);
	}
	function openQuery(): void {
		queryOpen = true;
		if (okResult) runQuery();
	}
	function runQuery(): void {
		if (!okResult) return;
		queryResult = queryJson(okResult.value, queryText);
		selectedQueryIndex = 0;
		queryExtracted = null;
	}
	function extractQueryResult(): void {
		if (!selectedQueryMatch) return;
		queryExtracted = selectedQueryMatch;
		queryOpen = false;
	}
	function openTransform(): void {
		if (!okResult) return;
		yamlSource = inputText;
		transformOpen = true;
		generateTransform();
	}
	function generateTransform(): void {
		transformError = "";
		if (transformMode === "yaml") {
			if (okResult) transformOutput = jsonToYaml(okResult.value);
			return;
		}
		if (transformMode === "json") {
			const result = yamlToJson(yamlSource);
			if (!result.ok) {
				transformOutput = "";
				transformError = result.error;
				return;
			}
			transformOutput = JSON.stringify(result.value, null, 2);
			return;
		}
		if (!okResult) return;
		transformOutput =
			transformMode === "typescript"
				? inferTypeScript(okResult.value)
				: JSON.stringify(inferJsonSchema(okResult.value), null, 2);
	}
	async function copyTransform(): Promise<void> {
		if (transformOutput) await copyText(transformOutput);
	}
	function openDiff(): void {
		diffLeft = inputText;
		diffRight = "";
		diffResult = null;
		diffError = "";
		diffOpen = true;
	}
	function runDiff(): void {
		try {
			const left = JSON.parse(diffLeft) as unknown;
			const right = JSON.parse(diffRight) as unknown;
			diffResult = diffJson(left, right);
			diffError = "";
		} catch (error) {
			diffResult = null;
			diffError = error instanceof Error ? error.message : "两侧都必须是合法 JSON";
		}
	}
	async function copyDiffPath(entry: JsonDiffEntry): Promise<void> {
		await copyText(entry.pathText);
	}
	function openHistory(): void {
		if (typeof localStorage !== "undefined") historyItems = readHistory(localStorage);
		historyOpen = true;
	}
	function restoreHistory(item: JsonHistoryItem): void {
		replaceInput(item.content);
		historyOpen = false;
	}
	function formatHistoryDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
	}
	function handleShortcut(event: KeyboardEvent): void {
		const action = shortcutAction(event);
		if (!action) return;
		event.preventDefault();
		switch (action) {
			case "format":
				format();
				break;
			case "minify":
				minify();
				break;
			case "copy":
				void copyInput();
				break;
			case "toggle-view":
				view = view === "tree" ? "preview" : "tree";
				break;
			case "clear":
				replaceInput("");
				break;
		}
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MB`;
	}

	// ---- 文件拖入（window 级，全窗口命中；$effect 清理函数负责解绑）----
	$effect(() => {
		const hasFiles = (e: DragEvent) =>
			Array.from(e.dataTransfer?.types ?? []).includes("Files");
		const onDragEnter = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			dragDepth += 1;
		};
		const onDragOver = (e: DragEvent) => {
			if (hasFiles(e)) e.preventDefault();
		};
		const onDragLeave = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			dragDepth = Math.max(0, dragDepth - 1);
		};
		const onDrop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			dragDepth = 0;
			const file = e.dataTransfer?.files?.[0];
			if (file) void file.text().then((text) => replaceInput(text));
		};
		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
		};
	});

	onDestroy(() => clearTimeout(copiedTimer));
</script>

<svelte:window onkeydown={handleShortcut} />

<div class="relative flex h-full min-h-0 flex-col">
	<!-- 工具栏：全部按钮带 title（渐进披露的引导层） -->
	<div class="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
		<Button
			size="sm"
			variant="ghost"
			onclick={format}
			disabled={!stats}
			title="格式化为 2 空格缩进（Cmd/Ctrl+Shift+F）"
		>
			<AlignLeft class="size-3.5" /><span class="hidden sm:inline">格式化</span>
		</Button>
		<Button
			size="sm"
			variant="ghost"
			onclick={minify}
			disabled={!stats}
			title="压缩成单行（Cmd/Ctrl+Shift+M）"
		>
			<Minimize2 class="size-3.5" /><span class="hidden sm:inline">压缩</span>
		</Button>
		<Button size="sm" variant="ghost" onclick={copyInput} disabled={!inputText} title="复制输入区内容（Cmd/Ctrl+Shift+C）">
			{#if copied}<CopyCheck class="size-3.5 text-green-600" />{:else}<Copy class="size-3.5" />{/if}
			<span class="hidden sm:inline">{copied ? "已复制" : "复制"}</span>
		</Button>
		<span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
		<Button size="sm" variant="ghost" onclick={expandAll} disabled={!stats} title="展开所有层级">
			<ChevronsUpDown class="size-3.5" /><span class="hidden sm:inline">展开</span>
		</Button>
		<Button size="sm" variant="ghost" onclick={collapseAll} disabled={!stats} title="收起到第一层">
			<ChevronsDownUp class="size-3.5" /><span class="hidden sm:inline">收起</span>
		</Button>
		<span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
		<Button size="sm" variant="ghost" onclick={() => replaceInput("")} disabled={!inputText} title="清空输入（Cmd/Ctrl+Shift+X）">
			<Trash2 class="size-3.5" /><span class="hidden sm:inline">清空</span>
		</Button>
		<Button size="sm" variant="ghost" onclick={loadExample} title="填充一份覆盖所有类型的示例数据">
			<FileJson class="size-3.5" /><span class="hidden sm:inline">示例</span>
		</Button>
		<span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
		<Button
			size="sm"
			variant="ghost"
			onclick={openQuery}
			disabled={!stats}
			title="按 JSONPath 查询（例如 $.user.contacts[0]）"
		>
			<Search class="size-3.5" /><span class="hidden sm:inline">查询</span>
		</Button>
		<Button
			size="sm"
			variant="ghost"
			onclick={openTransform}
			disabled={!stats}
			title="转换为 YAML、TypeScript 类型或 JSON Schema"
		>
			<ArrowLeftRight class="size-3.5" /><span class="hidden sm:inline">转换</span>
		</Button>
		<Button
			size="sm"
			variant="ghost"
			onclick={openDiff}
			title="对比两份 JSON 的键级差异"
		>
			<GitCompareArrows class="size-3.5" /><span class="hidden sm:inline">对比</span>
		</Button>
		<Button size="sm" variant="ghost" onclick={openHistory} title="查看最近打开的 10 条 JSON">
			<History class="size-3.5" /><span class="hidden sm:inline">历史</span>
		</Button>

		<div class="ml-auto">
			<Tabs.Root value={view} onValueChange={(v) => (view = v as "tree" | "preview")}>
				<Tabs.List class="h-7">
					<Tabs.Trigger value="tree" class="h-6 px-2.5 text-xs" title="以可折叠的树浏览结构（Cmd/Ctrl+Shift+V 切换）">
						树
					</Tabs.Trigger>
					<Tabs.Trigger value="preview" class="h-6 px-2.5 text-xs" title="格式化后的只读预览（Cmd/Ctrl+Shift+V 切换）">
						预览
					</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>
		</div>
	</div>

	<!-- 主区：桌面左右分栏，窄屏上下堆叠 -->
	<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
		<!-- 输入 pane -->
		<div class="flex h-44 shrink-0 flex-col border-b lg:h-auto lg:w-1/2 lg:border-b-0 lg:border-r">
			<CodeMirror
				doc={inputText}
				docId={String(docVersion)}
				filePath="data.json"
				lineNumbers={true}
				wide={true}
				placeholder="把 JSON 粘贴到这里，或点击上方「示例」试试；也可以直接把 .json 文件拖进窗口"
				onInput={handleInput}
			/>
		</div>

		<!-- 结果 pane -->
		<div class="min-h-0 flex-1 overflow-auto p-3">
			{#if !inputText.trim()}
				<!-- 空态：初级用户的起点 -->
				<div
					class="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground"
				>
					<FileJson class="size-10 opacity-40" aria-hidden="true" />
					<p class="max-w-xs text-sm leading-relaxed">
						在左侧粘贴一段 JSON，立刻看到结构化的树视图。<br />
						不知道从哪开始？<button
							type="button"
							class="text-primary underline underline-offset-2"
							onclick={loadExample}>加载示例数据</button
						>
					</p>
				</div>
			{:else if parseError}
				<!-- 错误卡：行列 + 人话原因 + 出错行摘录（Svelte 文本插值自动转义，无 XSS） -->
				<div class="mx-auto max-w-xl pt-6" role="alert">
					<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
						<div class="flex items-start gap-2.5">
							<span
								class="mt-0.5 inline-block size-2 shrink-0 rounded-full bg-destructive"
								aria-hidden="true"></span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium text-destructive">
									{#if parseError.line > 0}
										第 {parseError.line} 行 第 {parseError.column} 列
									{:else}
										解析失败
									{/if}
								</p>
								<p class="mt-1 text-sm">{parseError.message}</p>
								<p class="mt-1 text-xs text-muted-foreground">
									建议：{parseError.suggestion}
									</p>
									{#if historyItems.length > 0}
										<div class="mt-3 w-full max-w-sm text-left">
											<p class="mb-1 text-xs font-medium text-muted-foreground">最近打开</p>
											{#each historyItems.slice(0, 3) as item}
												<button
													type="button"
													class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
													onclick={() => restoreHistory(item)}
													title="恢复这条 JSON"
												>
													<span class="truncate font-mono">{item.content.slice(0, 48)}</span>
													<span class="shrink-0 text-muted-foreground">{formatHistoryDate(item.savedAt)}</span>
												</button>
											{/each}
										</div>
									{/if}
								{#if parseError.excerpt}
									<pre
										class="mt-2 overflow-x-auto rounded bg-muted/60 p-2 font-mono text-xs leading-relaxed">{parseError.excerpt}</pre>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{:else if okResult && stats}
				{#if view === "tree"}
					<div class="jv-tree">
						{#key parseSeq}
							{#if useVirtualTree}
								<JsonVirtualTree
									value={displayValue}
									command={treeCommand}
									highlightPath={queryExtracted ? null : selectedQueryMatch?.path}
								/>
							{:else}
								<JsonTreeNode
									name={null}
									value={displayValue}
									{defaultOpen}
									command={treeCommand}
									highlightPath={queryExtracted ? null : selectedQueryMatch?.path}
								/>
							{/if}
						{/key}
					</div>
				{:else}
					<div class="h-full min-h-0">
					<CodeMirror
						doc={JSON.stringify(okResult.value, null, 2)}
						docId={`preview:${parseSeq}`}
						filePath="data.json"
						lineNumbers={true}
						wide={true}
						readonly={true}
					/>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- 统计条 -->
	<div
		class="flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground"
	>
		{#if stats}
			<span title="原始文本大小">{formatBytes(stats.bytes)}</span>
			<span aria-hidden="true">·</span>
			<span title="顶层值的类型">{topTypeName}</span>
			<span aria-hidden="true">·</span>
			<span title="所有键值与元素的总数">{stats.nodeCount} 个节点</span>
			<span aria-hidden="true">·</span>
			<span title="最大嵌套层数">深度 {stats.maxDepth}</span>
		{:else if parseError}
			<span class="text-destructive">无法解析（详见错误提示）</span>
		{:else}
			<span>等待输入</span>
		{/if}
	</div>

	<!-- 拖拽遮罩 -->
	{#if dragDepth > 0}
		<div
			class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary bg-background/80"
		>
			<p class="text-sm font-medium text-primary">松开导入文件</p>
		</div>
	{/if}

	<Dialog.Root bind:open={queryOpen}>
		<Dialog.Content class="max-h-[85vh] max-w-2xl overflow-hidden">
			<Dialog.Header>
				<Dialog.Title>查询 JSON</Dialog.Title>
				<Dialog.Description>输入 JSONPath 子集，例如 $.user.contacts[0] 或 $..name。</Dialog.Description>
			</Dialog.Header>
			<div class="flex gap-2">
				<input
					class="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="JSONPath 查询表达式"
					bind:value={queryText}
					onkeydown={(event) => {
						if (event.key === "Enter") runQuery();
					}}
				/>
				<Button type="button" onclick={runQuery} title="执行查询（Enter）">运行</Button>
			</div>
			{#if queryResult && !queryResult.ok}
				<p class="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{queryResult.error}
				</p>
			{:else if queryResult?.ok}
				<div class="mt-3 grid min-h-0 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
					<div class="max-h-72 overflow-auto rounded-md border p-1 lg:max-h-[50vh]">
						{#if queryResult.matches.length === 0}
							<p class="p-3 text-sm text-muted-foreground">没有匹配结果。</p>
						{:else}
							{#each queryResult.matches as match, index}
								<button
									type="button"
									class="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
									class:bg-muted={index === selectedQueryIndex}
									onclick={() => (selectedQueryIndex = index)}
								>
									<span class="font-mono text-primary">{formatJsonPath(match.path)}</span>
									<span class="max-w-full truncate text-muted-foreground">{String(match.value)}</span>
								</button>
							{/each}
						{/if}
					</div>
					<div class="min-h-32 overflow-auto rounded-md border bg-muted/20 p-2">
						{#if selectedQueryMatch}
							<p class="mb-2 text-xs text-muted-foreground">
								已选：<span class="font-mono text-primary">{formatJsonPath(selectedQueryMatch.path)}</span>
							</p>
							<JsonTreeNode name={null} value={selectedQueryMatch.value} defaultOpen={true} />
						{:else}
							<p class="text-sm text-muted-foreground">选择一个结果预览。</p>
						{/if}
					</div>
				</div>
				<Dialog.Footer>
					{#if selectedQueryMatch}
						<Button type="button" variant="secondary" onclick={extractQueryResult} title="把选中的结果替换为当前树根">
							提取为新树
						</Button>
					{/if}
				</Dialog.Footer>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={transformOpen}>
		<Dialog.Content class="max-h-[85vh] max-w-3xl overflow-hidden">
			<Dialog.Header>
				<Dialog.Title>转换与推断</Dialog.Title>
				<Dialog.Description>把当前 JSON 转成常用格式，或从 YAML 导入为 JSON。</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-wrap gap-1 rounded-md bg-muted/50 p-1">
				{#each [
					["yaml", "JSON → YAML"],
					["json", "YAML → JSON"],
					["typescript", "TypeScript 类型"],
					["schema", "JSON Schema"],
				] as [mode, label]}
					<button
						type="button"
						class="rounded px-2.5 py-1.5 text-xs transition-colors hover:bg-background"
						class:bg-background={transformMode === mode}
						class:font-medium={transformMode === mode}
						onclick={() => {
							transformMode = mode as typeof transformMode;
							generateTransform();
						}}
					>
						{label}
					</button>
				{/each}
			</div>
			{#if transformMode === "json"}
				<textarea
					class="mt-3 h-32 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="YAML 输入"
					bind:value={yamlSource}
					oninput={generateTransform}
					placeholder="粘贴 YAML…"
				></textarea>
			{/if}
			{#if transformError}
				<p class="mt-3 rounded-md bg-destructive/10 p-3 text-xs text-destructive" role="alert">
					{transformError}
				</p>
			{/if}
			<textarea
				class="mt-3 h-64 w-full resize-y rounded-md border bg-muted/20 p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="转换结果"
				readonly
				value={transformOutput}
			></textarea>
			<Dialog.Footer>
				<Button type="button" variant="secondary" onclick={copyTransform} disabled={!transformOutput} title="复制转换结果">
					<Copy class="size-3.5" />复制结果
				</Button>
				{#if transformMode === "json" && transformOutput && !transformError}
					<Button
						type="button"
						onclick={() => {
							replaceInput(transformOutput);
							transformOpen = false;
						}}
						title="用转换结果替换输入区"
					>
						导入 JSON
					</Button>
				{/if}
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={diffOpen}>
		<Dialog.Content class="max-h-[88vh] max-w-4xl overflow-hidden">
			<Dialog.Header>
				<Dialog.Title>对比 JSON</Dialog.Title>
				<Dialog.Description>粘贴左右两份 JSON，按键和数组下标查看新增、删除与修改。</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-3 md:grid-cols-2">
				<label class="grid gap-1 text-xs font-medium">
					<span>原始 JSON</span>
					<textarea
						class="h-40 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
						bind:value={diffLeft}
						aria-label="原始 JSON"
					></textarea>
				</label>
				<label class="grid gap-1 text-xs font-medium">
					<span>新 JSON</span>
					<textarea
						class="h-40 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
						bind:value={diffRight}
						aria-label="新 JSON"
					></textarea>
				</label>
			</div>
			<div class="flex justify-end">
				<Button type="button" onclick={runDiff} title="执行 JSON 对比">开始对比</Button>
			</div>
			{#if diffError}
				<p class="rounded-md bg-destructive/10 p-3 text-xs text-destructive" role="alert">{diffError}</p>
			{:else if diffResult}
				<div class="max-h-64 overflow-auto rounded-md border">
					{#if diffResult.length === 0}
						<p class="p-4 text-sm text-muted-foreground">两份 JSON 没有差异。</p>
					{:else}
						{#each diffResult as entry}
							<div class="grid gap-1 border-b px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1fr)] sm:items-center">
								<button
									type="button"
									class="truncate text-left font-mono text-primary underline-offset-2 hover:underline"
									onclick={() => copyDiffPath(entry)}
									title="复制路径"
								>
									{entry.pathText}
								</button>
								<span
									class:text-green-600={entry.kind === "added"}
									class:text-red-600={entry.kind === "removed"}
									class:text-amber-600={entry.kind === "changed"}
									class="font-medium"
								>
									{entry.kind === "added" ? "新增" : entry.kind === "removed" ? "删除" : "修改"}
								</span>
								<span class="truncate text-muted-foreground">
									{entry.kind === "added" ? `+ ${String(entry.after)}` : entry.kind === "removed" ? `− ${String(entry.before)}` : `${String(entry.before)} → ${String(entry.after)}`}
								</span>
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={historyOpen}>
		<Dialog.Content class="max-h-[80vh] max-w-xl overflow-hidden">
			<Dialog.Header>
				<Dialog.Title>最近打开</Dialog.Title>
				<Dialog.Description>最近保存的 10 条 JSON，只保存在当前浏览器。</Dialog.Description>
			</Dialog.Header>
			<div class="max-h-[55vh] overflow-auto rounded-md border">
				{#if historyItems.length === 0}
					<p class="p-4 text-sm text-muted-foreground">还没有历史记录。</p>
				{:else}
					{#each historyItems as item}
						<button
							type="button"
							class="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
							onclick={() => restoreHistory(item)}
							title="恢复这条 JSON"
						>
							<span class="min-w-0 flex-1 truncate font-mono text-xs">{item.content.slice(0, 80)}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								{formatHistoryDate(item.savedAt)} · {formatBytes(item.bytes)}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Root>
</div>

<style>
	.jv-tree {
		font-family: var(--font-mono, ui-monospace, monospace);
	}
</style>
