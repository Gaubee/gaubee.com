<!--
	正交意图：
	1. 原始需求（2026-07-21）：长文需要桌面和移动 TOC。
	2. 原始需求（2026-07-22）：桌面 TOC 位于右侧；拉伸的侧栏承载吸顶，内部目录独立滚动，避免与应用导航叠加在左侧。
	3. 从内容管道（contentQuery）阅读文章，并保持前后文章导航。

	2026-10-09：头部+正文抽取为 ArticleDetailContent 共享（事件工作区第三段内嵌复用）；
	本组件保留「场景层」：返回按钮 / TOC / 上一篇下一篇 / 滚动重置。
	事件条目的返回按钮带月份回落（/app/event?month=…），与三段工作区状态对齐。
-->
<script lang="ts">
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { useParams } from '$lib/router'
  import { resetScrollFrom } from '$lib/utils/scroll'
  import TocTree from './TocTree.svelte'
  import ArticleDetailContent from './ArticleDetailContent.svelte'
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'

  interface Props {}

  let {}: Props = $props();

  /** 正文容器（bind:this，传给 TocTree 作为 ScrollSpy 的 container）。 */
  let articleContentEl: HTMLElement | undefined = $state();

  /** 从 router context 拿到 parse 后的 collection/stem（类型安全，zod 已校验）。
   *  useParams 返回 getter，需 $derived 包装才能响应 URL 变化。 */
  type ArticleDetailParams = { collection: 'articles' | 'events'; stem: string };
  const getParams = useParams<ArticleDetailParams>();

  /** 解析路径参数。 */
  const target = $derived.by(() => {
    const p = getParams?.()
    if (!p) return null
    return { collection: p.collection, stem: p.stem }
  })

  /** 当前文章。 */
  const post = $derived.by<ContentEntry | null>(() => {
    void contentQuery.version
    if (!target) return null
    return contentQuery.findPost(target.collection, target.stem)
  })

  /** 同集合所有文章（按 date 降序）。 */
  const siblings = $derived.by<ContentEntry[]>(() => {
    void contentQuery.version
    return target ? contentQuery.siblings(target.collection) : []
  })

  /** 当前索引。 */
  const currentIndex = $derived(
    post ? siblings.findIndex((p) => p.id.stem === post.id.stem) : -1
  )

  /** 上一篇（更新的）。 */
  const newer = $derived(currentIndex > 0 ? siblings[currentIndex - 1] : null)
  /** 下一篇（更旧的）。 */
  const older = $derived(
    currentIndex >= 0 && currentIndex < siblings.length - 1
      ? siblings[currentIndex + 1]
      : null
  )

  function gotoPost(p: ContentEntry) {
    navController.navigateMain(`/article/${p.collection}/${p.id.stem}`)
  }

  /** 月份键（YYYY-MM，与事件工作区 ?month= 同口径）。 */
  function monthKeyOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  function backToList() {
    if (target?.collection === 'events') {
      // 事件回落到三段工作区并定位到条目所在月份（2026-10-09 三段布局裁决 1）
      const month = post ? monthKeyOf(post.date) : ''
      navController.navigateMain(month ? `/app/event?month=${month}` : '/app/event')
    } else {
      navController.navigateMain('/app/articles')
    }
  }

  // 切篇重置滚动量（2026-10-06 走查）：上一篇/下一篇/搜索跳转都换 stem，DOM 更新后归零
  $effect(() => {
    void post?.id.stem
    resetScrollFrom(articleContentEl)
  })
</script>

<div class="mx-auto max-w-[78rem] px-4 py-6 sm:px-6 lg:px-8">
  {#if !target || !post}
    <div class="flex h-64 items-center justify-center">
      <p class="text-muted-foreground text-sm">文章未找到</p>
    </div>
  {:else}
    <!-- 返回按钮 -->
    <button
      class="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1.5 text-sm transition-colors"
      onclick={backToList}
    >
      <ArrowLeftIcon class="size-4" />
      <span>返回{post.collection === 'events' ? '事件' : '文章'}列表</span>
    </button>

    <div class="xl:grid xl:grid-cols-[minmax(0,72ch)_14rem] xl:justify-center xl:gap-x-10">
      <!-- 主内容区：控制行宽，避免宽屏阅读时单行过长。头部+正文为共享组件
           ArticleDetailContent（事件工作区第三段同源渲染）。 -->
      <div class="min-w-0">
        <ArticleDetailContent {post} bind:contentEl={articleContentEl} />

        <!-- 上一篇/下一篇 -->
        <nav class="mt-12 flex gap-4 border-t pt-6" aria-label="文章导航">
          {#if newer}
            <button
              class="hover:bg-accent/50 flex flex-1 flex-col items-start rounded-lg border p-4 text-left transition-colors"
              onclick={() => gotoPost(newer)}
            >
              <span class="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
                <ChevronLeftIcon class="size-3" /> 上一篇
              </span>
              <span class="font-medium">
                {newer.title}
              </span>
            </button>
          {:else}
            <div class="flex-1"></div>
          {/if}

          {#if older}
            <button
              class="hover:bg-accent/50 flex flex-1 flex-col items-end rounded-lg border p-4 text-right transition-colors"
              onclick={() => gotoPost(older)}
            >
              <span class="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
                下一篇 <ChevronRightIcon class="size-3" />
              </span>
              <span class="font-medium">
                {older.title}
              </span>
            </button>
          {:else}
            <div class="flex-1"></div>
          {/if}
        </nav>
      </div>

      <!-- 桌面端 TOC：全局应用导航在左，文章导航固定在右。 -->
      <aside class="hidden xl:block">
        <TocTree markdown={post.body} contentEl={articleContentEl} />
      </aside>
    </div>

    <!-- 移动端 TOC（浮动按钮 + Sheet） -->
    <div class="xl:hidden">
      <TocTree markdown={post.body} contentEl={articleContentEl} />
    </div>
  {/if}
</div>
