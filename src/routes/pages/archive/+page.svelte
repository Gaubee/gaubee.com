<script lang="ts">
  let { data } = $props();
  const posts = $derived(data.posts);

  function formatMonth(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
  }

  // 按年月分组
  const grouped = $derived.by(() => {
    const map = new Map<string, typeof posts>();
    for (const p of posts) {
      const key = formatMonth(p.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()];
  });
</script>

<svelte:head>
  <title>归档 · Gaubee</title>
  <meta name="description" content="按时间归档的所有文章与短评。" />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8">
  <h1 class="mb-6 text-2xl font-bold">归档</h1>
  {#each grouped as [month, items] (month)}
    <section class="mb-6">
      <h2 class="text-muted-foreground mb-2 text-sm font-semibold">{month}</h2>
      <div class="flex flex-col gap-0.5">
        {#each items as post (post.collection + post.stem)}
          <a href={`/pages/article/${post.collection}/${post.stem}`} class="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors">
            <span class="text-muted-foreground w-6 shrink-0 text-xs">{new Date(post.date).getDate()}</span>
            <span class="truncate">{post.title}</span>
            <span class="text-muted-foreground ml-auto text-xs">{post.collection === "articles" ? "文章" : "短评"}</span>
          </a>
        {/each}
      </div>
    </section>
  {/each}
</div>
