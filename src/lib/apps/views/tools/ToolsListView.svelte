<script lang="ts">
  /**
   * ToolsListView — 工具集列表（按形态分组）
   *
   * webapp 在上：能直接点开用。
   * self-hosted 在下：点开看部署说明（没有在线运行入口，这是刻意的）。
   */
  import { onMount } from "svelte";

  import { loadIndex, type ToolIndex, type ToolMeta } from "$lib/apps/tools/tools-data";

  let index = $state<ToolIndex | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    const j = await loadIndex();
    if (!j) {
      error = "工具索引加载失败（/static/tools/index.json 可能还没生成）";
      return;
    }
    index = j;
  });

  const webapps = $derived<ToolMeta[]>(index?.tools.filter((t) => t.form === "webapp") ?? []);
  const selfHosted = $derived<ToolMeta[]>(index?.tools.filter((t) => t.form === "self-hosted") ?? []);
</script>

<div class="tools-page">
  <header>
    <h1>工具集</h1>
    <p class="lede">
      工坊产出的工具。能在这里直接跑的都在浏览器里算，数据是公开投影；
      需要本地环境或私有数据的给部署说明。
    </p>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {:else if !index}
    <p class="muted">加载中…</p>
  {:else}
    <section>
      <h2>能直接用（{webapps.length}）</h2>
      <ul class="tool-list">
        {#each webapps as t (t.id)}
          <li>
            <a class="tool-card" href={`/app/tools/${t.id}`}>
              <span class="tool-name">{t.name}</span>
              <span class="tool-summary">{t.summary}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2>需要自托管（{selfHosted.length}）</h2>
      <p class="hint">这些要用你自己的数据或凭据，所以只给部署说明，不在网页里跑。</p>
      <ul class="tool-list">
        {#each selfHosted as t (t.id)}
          <li>
            <a class="tool-card self" href={`/app/tools/${t.id}`}>
              <span class="tool-name">{t.name}</span>
              <span class="tool-summary">{t.summary}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .tools-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.25rem;
    max-width: 52rem;
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }
  h2 {
    font-size: 0.875rem;
    font-weight: 600;
    opacity: 0.75;
    margin-bottom: 0.5rem;
  }
  .lede,
  .hint {
    font-size: 0.8125rem;
    opacity: 0.7;
    line-height: 1.55;
  }
  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .tool-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid color-mix(in oklab, currentColor 12%, transparent);
    text-decoration: none;
    color: inherit;
  }
  .tool-card:hover {
    background: color-mix(in oklab, currentColor 5%, transparent);
  }
  .tool-card.self {
    border-style: dashed;
    opacity: 0.9;
  }
  .tool-name {
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .tool-summary {
    font-size: 0.75rem;
    opacity: 0.7;
    line-height: 1.5;
  }
  .error {
    color: var(--color-danger, #c33);
    font-size: 0.8125rem;
  }
  .muted {
    opacity: 0.6;
    font-size: 0.8125rem;
  }
</style>
