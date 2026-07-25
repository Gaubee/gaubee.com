<!--
	GithubView：路由分发器（列表页 ↔ 详情页）。

	v3 架构：单组件按 pathname 二级分发，列表 DOM 常驻保活（tabView）。
	- /app/github                         → 列表页（RepoListView）
	- /app/github/repo/{owner}/{repo}     → 仓库详情页（RepoDetailView）
	- /app/github/list/{type}             → 分页列表（RepoListView 的展开全部，复用列表组件 + query 参数）

	状态保活：GithubView 作为 tabView 常驻 DOM（display 切换），
	列表与详情的内部状态（滚动位置/展开/搜索词）天然保留。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import RepoListView from './github/RepoListView.svelte'
  import RepoDetailView from './github/RepoDetailView.svelte'

  const navState = $derived(navStore.current)

  // pathname 分发：详情页 /app/github/repo/{owner}/{repo}
  const detailTarget = $derived.by(() => {
    const path = navState.mainLocation.pathname
    const match = path.match(/^\/app\/github\/repo\/([^/]+)\/([^/]+)\/?$/)
    return match ? { owner: match[1], repo: match[2] } : null
  })

  // 分页列表 /app/github/list/{type}（type=favorites|user:{login}|org:{org}）
  const listTarget = $derived.by(() => {
    const path = navState.mainLocation.pathname
    const match = path.match(/^\/app\/github\/list\/(.+)$/)
    return match ? match[1] : null
  })
</script>

{#if detailTarget}
  <RepoDetailView owner={detailTarget.owner} repo={detailTarget.repo} />
{:else}
  <!-- 列表页 + 分页列表共用 RepoListView（listTarget 作为初始筛选条件）-->
  <RepoListView listFilter={listTarget} />
{/if}
