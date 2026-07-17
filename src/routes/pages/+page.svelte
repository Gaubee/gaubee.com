<script lang="ts">
  let { data } = $props();
  const posts = $derived(data.posts);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  }
</script>

<svelte:head>
  <title>Gaubee · 阅读站</title>
  <meta name="description" content="Gaubee 的文章与短评，关于 Web 开发、技术与生活。" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Gaubee · 阅读站" />
  <meta property="og:description" content="Gaubee 的文章与短评，关于 Web 开发、技术与生活。" />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8">
  <h1 class="mb-6 text-2xl font-bold">阅读</h1>

  <div class="flex flex-col gap-4">
    {#each posts as post (post.collection + post.stem)}
      <article class="border-border border-b pb-4">
        <div class="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
          <span>{post.collection === "articles" ? "文章" : "短评"}</span>
          <span>·</span>
          <time datetime={post.date}>{formatDate(post.date)}</time>
        </div>
        <h2 class="mb-1 text-lg font-semibold">
          <a href={`/pages/article/${post.collection}/${post.stem}`} class="hover:underline">
            {post.title}
          </a>
        </h2>
        {#if post.excerpt}
          <p class="text-muted-foreground text-sm">{post.excerpt}…</p>
        {/if}
        {#if post.tags.length > 0}
          <div class="mt-2 flex flex-wrap gap-1.5 text-xs">
            {#each post.tags.slice(0, 5) as tag}
              <a href={`/pages/tags/${encodeURIComponent(tag)}`} class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 hover:bg-accent">{tag}</a>
            {/each}
          </div>
        {/if}
      </article>
    {/each}
  </div>
</div>
