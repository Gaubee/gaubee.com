<script lang="ts">
  let { data } = $props();
  const tag = $derived(data.tag);
  const posts = $derived(data.posts);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  }
</script>

<svelte:head>
  <title>标签：{tag} · Gaubee</title>
  <meta name="description" content="标签「{tag}」下的所有文章与短评。" />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8">
  <h1 class="mb-6 text-2xl font-bold">标签：{tag}</h1>
  {#if posts.length === 0}
    <p class="text-muted-foreground">没有带此标签的内容。</p>
  {:else}
    <div class="flex flex-col gap-3">
      {#each posts as post (post.collection + post.stem)}
        <a href={`/pages/article/${post.collection}/${post.stem}`} class="border-border hover:bg-accent block border-b pb-3 transition-colors">
          <div class="text-muted-foreground mb-0.5 text-xs">
            {post.collection === "articles" ? "文章" : "短评"} · {formatDate(post.date)}
          </div>
          <div class="font-semibold">{post.title}</div>
        </a>
      {/each}
    </div>
  {/if}
</div>
