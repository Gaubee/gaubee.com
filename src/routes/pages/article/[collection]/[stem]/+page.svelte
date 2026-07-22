<script lang="ts">
  let { data } = $props();
  const article = $derived(data);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  }
</script>

<svelte:head>
  <title>{article.title} · Gaubee</title>
  <meta name="description" content={article.raw.replace(/[#*>`\[\]()!-]/g, "").replace(/\s+/g, " ").trim().slice(0, 160)} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={article.title} />
  <meta property="og:description" content={article.raw.replace(/[#*>`\[\]()!-]/g, "").replace(/\s+/g, " ").trim().slice(0, 160)} />
  <link rel="alternate" type="text/markdown" href={`/pages/raw/${article.collection}/${article.stem}.md`} />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8">
  <!-- 文章头部 -->
  <header class="mb-8">
    <div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span>{article.collection === "articles" ? "文章" : "短评"}</span>
      <span>·</span>
      <time datetime={article.date}>{formatDate(article.date)}</time>
      {#if article.updated && article.updated !== article.date}
        <span>·</span>
        <span>更新于 <time datetime={article.updated}>{formatDate(article.updated)}</time></span>
      {/if}
    </div>
    <h1 class="mb-3 text-3xl font-bold">{article.title}</h1>
    {#if article.tags.length > 0}
      <div class="flex flex-wrap gap-1.5 text-xs">
        {#each article.tags as tag}
          <a href={`/pages/tags/${encodeURIComponent(tag)}`} class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 hover:bg-accent">{tag}</a>
        {/each}
      </div>
    {/if}
    <!-- 互链：编辑器打开 + raw md -->
    <div class="text-muted-foreground mt-4 flex gap-3 text-xs">
      <a href={`/app/editor/${article.collection}/${article.stem}`} class="hover:text-foreground underline">在编辑器打开</a>
      <a href={`/pages/raw/${article.collection}/${article.stem}.md`} class="hover:text-foreground underline">查看原始 Markdown</a>
    </div>
  </header>

  <!-- 正文（SSG 预渲染 HTML） -->
  <div class="prose prose-sm dark:prose-invert max-w-none">
    {@html article.html}
  </div>

  <!-- 返回 -->
  <nav class="mt-12 border-t border-border pt-6">
    <a href="/pages" class="text-muted-foreground hover:text-foreground text-sm">← 返回阅读</a>
  </nav>
</div>
