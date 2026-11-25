<script lang="ts">
  /**
   * ToolDetailView — 单个工具详情
   *
   * webapp：直接给可用的界面（收藏检索 / 时间线 / 依赖溯源 / X 检索）。
   * self-hosted：只给部署说明与仓库名，不提供在线运行（它需要私有数据或本地环境）。
   *
   * 所有查询纯前端，数据来自 /static/tools/data/*.json。
   */
  import { useParams } from "$lib/router";
  import { onMount } from "svelte";

  import {
    findDep,
    loadDeps,
    loadIndex,
    loadStars,
    loadX,
    searchStars,
    searchX,
    starTimeline,
    starXCross,
    topicDrift,
    type DepRepo,
    type StarRepo,
    type ToolMeta,
    type XItem,
  } from "$lib/apps/tools/tools-data";

  // useParams 返回 getter（可能 undefined），必须 $derived 包装才能响应 URL 变化
  const getParams = useParams<{ toolId: string }>();
  const toolId = $derived(getParams?.()?.toolId ?? "");

  let tool = $state<ToolMeta | null>(null);
  let notFound = $state(false);
  let stars = $state<StarRepo[]>([]);
  let deps = $state<DepRepo[]>([]);
  let xitems = $state<XItem[]>([]);
  let loading = $state(true);

  // 查询状态
  let query = $state("");
  const results = $derived<Tabellike[]>(computeResults());

  type Tabellike = { a: string; b: string; c?: string };

  $effect(() => {
    void toolId;
    void query;
    void stars;
    void deps;
    void xitems;
  });

  function computeResults(): Tabellike[] {
    const q = query.trim();
    if (toolId === "star-x-cross") {
      const cross = starXCross(stars, xitems, q);
      return cross.hits.map((h) => ({
        a: h.repo.name,
        b: `${h.repo.desc.slice(0, 80)} · ${h.sample.replace(/\s+/g, " ").slice(0, 70)}`,
        c: `${h.count} 条 · ${h.latest} · ${h.authors.slice(0, 2).map((a) => `@${a}`).join("、")}`,
      }));
    }
    if (toolId === "stars-drift") {
      const d = topicDrift(stars, 30);
      const list = q ? d.topics.filter((t) => t.topic.includes(q.toLowerCase())) : d.topics;
      return list.map((t) => ({
        a: t.topic,
        b: `近 30 天 ${t.recent} · 前 30 天 ${t.prior}`,
        c: `${t.delta >= 0 ? "+" : ""}${t.delta}`,
      }));
    }
    if (!q) return [];
    if (["stars-search", "star-at", "star-readme", "stale-check"].includes(toolId)) {
      return searchStars(stars, q, { archived: toolId === "stale-check" ? true : null })
        .slice(0, 30)
        .map((r) => ({ a: r.name, b: r.desc.slice(0, 90), c: `${r.lang} ★${r.stars}` }));
    }
    if (["deps-why", "deps-digest"].includes(toolId)) {
      return findDep(deps, q)
        .slice(0, 30)
        .map((r) => ({ a: r.repo, b: r.deps.map((d) => `${d.name}@${d.v}`).join(", "), c: `在 ${r.deps[0]?.sec ?? ""}` }));
    }
    if (["x-search", "x-top-authors"].includes(toolId)) {
      return searchX(xitems, q)
        .slice(0, 20)
        .map((it) => ({
          a: `@${it.author}`,
          b: `${(it.zh ?? it.text).slice(0, 120)}${
            it.quote ? ` ｜ 引用 @${it.quote.author}：${(it.quote.zh ?? it.quote.text).slice(0, 80)}` : ""
          }`,
          c: it.at,
        }));
    }
    return [];
  }

  const timeline = $derived(toolId === "star-timeline" ? starTimeline(stars, 120) : []);
  const cross = $derived(toolId === "star-x-cross" ? starXCross(stars, xitems) : null);
  const drift = $derived(toolId === "stars-drift" ? topicDrift(stars, 30) : null);

  onMount(async () => {
    const idx = await loadIndex();
    tool = idx?.tools.find((t) => t.id === toolId) ?? null;
    if (!tool) {
      notFound = true;
      loading = false;
      return;
    }
    if (tool.dataNeeds.includes("stars")) stars = (await loadStars())?.repos ?? [];
    if (tool.dataNeeds.includes("deps")) deps = (await loadDeps())?.repos ?? [];
    if (tool.dataNeeds.includes("x")) xitems = (await loadX())?.items ?? [];
    loading = false;
  });

  const runnable = $derived([
    "stars-search",
    "star-at",
    "star-readme",
    "stale-check",
    "deps-why",
    "deps-digest",
    "x-search",
    "x-top-authors",
    "star-browse",
    "tech-adoption",
    "star-x-cross",
    "stars-drift",
  ]);
  const isRunnable = $derived(runnable.includes(toolId));
</script>

<div class="tool-detail">
  {#if notFound}
    <p class="error">没有这个工具：{toolId}</p>
  {:else if loading || !tool}
    <p class="muted">加载中…</p>
  {:else}
    <header>
      <a class="back" href="/app/tools">← 工具集</a>
      <h1>{tool.name}</h1>
      <p class="summary">{tool.summary}</p>
    </header>

    {#if tool.form === "webapp" && isRunnable}
      <section class="runner">
        <label for="q">检索</label>
        <input id="q" bind:value={query} placeholder="输入关键词，多个词用空格分开" />

        {#if toolId === "star-timeline"}
          <p class="muted">近 120 天收藏增长：</p>
          <ul class="timeline">
            {#each timeline as t (t.date)}
              <li><span>{t.date}</span><span>+{t.added}</span><span>累计 {t.total}</span></li>
            {/each}
          </ul>
        {:else if toolId === "star-x-cross"}
          {#if query.trim()}
            <p class="count">命中 {results.length} 条</p>
            <ul class="results">
              {#each results as r (r.a)}
                <li><span class="a">{r.a}</span><span class="b">{r.b}</span>{#if r.c}<span class="c">{r.c}</span>{/if}</li>
              {/each}
            </ul>
          {:else if cross}
            <p class="muted">收藏 {cross.stars} · X {cross.posts} 条 · 交叉命中 {cross.hitCount} 个仓库 / {cross.mentionCount} 条动态</p>
            <ul class="results">
              {#each cross.hits.slice(0, 12) as h (h.repo.name)}
                <li>
                  <span class="a">{h.repo.name} <small>★{h.repo.stars} {h.repo.lang}</small></span>
                  <span class="b">{h.repo.desc.slice(0, 80)} · {h.sample.replace(/\s+/g, " ").slice(0, 90)}</span>
                  <span class="c">{h.count} 条 · {h.latest} · {h.authors.slice(0, 2).map((a) => `@${a}`).join("、")}</span>
                </li>
              {/each}
            </ul>
            <h2>动态里出现、尚未收藏（{cross.candidates.length}）</h2>
            <ul class="results">
              {#each cross.candidates.slice(0, 10) as c (c.repo)}
                <li>
                  <span class="a">{c.repo}</span>
                  <span class="b">{c.sample.replace(/\s+/g, " ").slice(0, 90)}</span>
                  <span class="c">{c.count} 条 · {c.latest} · {c.authors.slice(0, 2).map((a) => `@${a}`).join("、")}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if toolId === "stars-drift"}
          {#if drift}
            <p class="muted">近 {drift.days} 天 {drift.window} 个新星标（前一期 {drift.prev}）；主题按增量排序</p>
            <ul class="results">
              {#each (query.trim() ? results : drift.topics.map((t) => ({ a: t.topic, b: `近 30 天 ${t.recent} · 前 30 天 ${t.prior}`, c: `${t.delta >= 0 ? "+" : ""}${t.delta}` }))) as r (r.a)}
                <li><span class="a">{r.a}</span><span class="b">{r.b}</span>{#if r.c}<span class="c">{r.c}</span>{/if}</li>
              {/each}
            </ul>
            <p class="muted">语言（近 / 前）：{drift.languages.map((l) => `${l.lang} ${l.recent}/${l.prior}`).join("、")}</p>
          {/if}
        {:else if query.trim()}
          <p class="count">命中 {results.length} 条{results.length >= 20 ? "（已截断）" : ""}</p>
          <ul class="results">
            {#each results as r (r.a)}
              <li>
                <span class="a">{r.a}</span>
                <span class="b">{r.b}</span>
                {#if r.c}<span class="c">{r.c}</span>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">输入关键词开始检索（数据在本地算，不发请求）</p>
        {/if}
      </section>
    {:else}
      <section class="self-hosted">
        <h2>自托管部署</h2>
        <p>这个工具需要你自己的数据或本地环境，网页里跑不了。</p>
        <dl>
          <dt>仓库</dt>
          <dd><code>{tool.repo ?? `gaubee-tool-${tool.id}`}</code></dd>
          <dt>安装</dt>
          <dd><code>git clone https://github.com/Gaubee/{tool.repo ?? `gaubee-tool-${tool.id}`}</code></dd>
          <dt>运行</dt>
          <dd><code>bun run xxx.ts</code>（具体见仓库 README）</dd>
        </dl>
        <p class="muted">
          部署说明在仓库 README 里；如果你只是想知道它做什么，上面那段摘要就够了。
        </p>
      </section>
    {/if}
  {/if}
</div>

<style>
  .tool-detail {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.25rem;
    max-width: 52rem;
  }
  .back {
    font-size: 0.75rem;
    opacity: 0.65;
    text-decoration: none;
    color: inherit;
  }
  h1 {
    font-size: 1.125rem;
    font-weight: 600;
    font-family: var(--font-mono, ui-monospace, monospace);
    margin-top: 0.5rem;
  }
  h2 {
    font-size: 0.875rem;
    font-weight: 600;
    opacity: 0.8;
  }
  .summary {
    font-size: 0.8125rem;
    opacity: 0.72;
    line-height: 1.55;
    margin-top: 0.25rem;
  }
  .runner label {
    font-size: 0.75rem;
    opacity: 0.7;
    display: block;
    margin-bottom: 0.35rem;
  }
  .runner input {
    width: 100%;
    padding: 0.5rem 0.625rem;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    font-size: 0.8125rem;
  }
  .count {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-top: 0.5rem;
  }
  .results,
  .timeline {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .results li {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid color-mix(in oklab, currentColor 8%, transparent);
  }
  .results .a {
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .results .b {
    font-size: 0.75rem;
    opacity: 0.72;
    line-height: 1.45;
  }
  .results .c {
    font-size: 0.6875rem;
    opacity: 0.55;
  }
  .timeline li {
    display: grid;
    grid-template-columns: 6rem 4rem 1fr;
    font-size: 0.75rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    opacity: 0.8;
  }
  .self-hosted dl {
    display: grid;
    grid-template-columns: 4rem 1fr;
    gap: 0.4rem 0.75rem;
    font-size: 0.75rem;
    margin-top: 0.75rem;
  }
  .self-hosted dt {
    opacity: 0.6;
  }
  .self-hosted code {
    font-family: var(--font-mono, ui-monospace, monospace);
    word-break: break-all;
  }
  .error {
    color: var(--color-danger, #c33);
    font-size: 0.8125rem;
  }
  .muted {
    opacity: 0.6;
    font-size: 0.75rem;
    line-height: 1.5;
  }
</style>
