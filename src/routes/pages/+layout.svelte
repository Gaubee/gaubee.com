<!--
	SSG 阅读站布局：极简静态布局（顶栏 + main + 页脚）。
	不依赖 NavController/authStore，纯 SSR 友好。
-->
<script lang="ts">
  let { children } = $props();
</script>

<div class="min-h-dvh flex flex-col bg-background text-foreground">
  <!-- 顶栏 -->
  <header class="border-b border-border">
    <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
      <a href="/pages" class="font-semibold">Gaubee</a>
      <nav class="flex items-center gap-4 text-sm text-muted-foreground">
        <a href="/pages" class="hover:text-foreground">阅读</a>
        <a href="/pages/archive" class="hover:text-foreground">归档</a>
        <a href="/" class="hover:text-foreground">编辑器</a>
      </nav>
    </div>
  </header>

  <!-- 主内容 -->
  <main class="flex-1">
    {@render children?.()}
  </main>

  <!-- 页脚 -->
  <footer class="border-t border-border">
    <div class="text-muted-foreground mx-auto max-w-3xl px-4 py-6 text-center text-xs">
      © Gaubee · 内容存于 GitHub，静态生成 · <a href="/" class="underline hover:text-foreground">在编辑器打开</a>
    </div>
  </footer>
</div>
