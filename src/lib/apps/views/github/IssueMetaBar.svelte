<!--
	IssueMetaBar：Issue 详情的元信息缩略行 + 点击弹出 Dialog 看完整信息。

	设计动机（2026-07-27）：
	- title 区的「作者头像+名字+时间」与 timeline 第一条卡片 header 重复 → 删除
	- 改为极简单行缩略（assignees 头像 / labels 彩色圆点 / milestone），
	  点击弹 Dialog 看完整信息（参考 GitHub 官方右侧 sidebar）。
	- 缩略行只显示「有值」的字段，无值不渲染该 chip，保持极简。

	布局：
	  ┌──────────────────────────────────────────────────┐
	  │ [👤👤] 2 · [● ● ●] 3 labels · 📅 v1.0   ⋯ Open ↗ │  ← 一行可点
	  └──────────────────────────────────────────────────┘
	Dialog 内容（参考 GitHub sidebar）：
	  - Assignees（头像+login 列表）
	  - Labels（彩色 label 完整）
	  - Milestone（标题）
	  - Participants（从 events actor 聚合）
	  - Created / Updated 时间
-->
<script lang="ts">
  import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
  } from '$lib/components/ui/dialog'
  import { labelStyleString } from '$lib/utils/label-color'
  import type { IssueDetail, IssueEvent } from '$lib/apps/installable/github/issue-api'
  import MilestoneIcon from '@lucide/svelte/icons/milestone'
  import InfoIcon from '@lucide/svelte/icons/info'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import MessageCircleIcon from '@lucide/svelte/icons/message-circle'

  let {
    issue,
    events = [],
  }: {
    issue: IssueDetail
    /** timeline 事件列表（用于聚合 participants）。 */
    events?: IssueEvent[]
  } = $props()

  /** 缩略行永远渲染：基础信息（创建时间 + 评论数）兜底，meta 字段（assignees/labels/milestone）有值时叠加。
   *  Dialog 内容也永远有（Participants + 时间 + 评论数），所以无守卫必要。 */
  const hasMeta = $derived(
    issue.assignees.length > 0 || issue.labels.length > 0 || issue.milestone,
  )

  /** participants：从 events.actor + issue.user + assignees 聚合，去重。
   *  GitHub sidebar 的 Notifications 区块类似呈现。 */
  const participants = $derived.by(() => {
    const map = new Map<string, { login: string; avatar_url: string }>()
    map.set(issue.user.login, issue.user)
    for (const a of issue.assignees) map.set(a.login, a)
    for (const e of events) {
      if (e.actor) map.set(e.actor.login, { login: e.actor.login, avatar_url: e.actor.avatar_url })
    }
    return Array.from(map.values())
  })

  /** 相对时间格式化。 */
  function formatTimeAgo(iso: string): string {
    try {
      const diff = Date.now() - new Date(iso).getTime()
      const day = 24 * 60 * 60 * 1000
      if (diff < 60 * 1000) return '刚刚'
      if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
      if (diff < day) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`
      if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
      return new Date(iso).toLocaleDateString('zh-CN', { dateStyle: 'short' })
    } catch {
      return iso
    }
  }

  /** 完整时间格式化（Dialog 用，含具体时间）。 */
  function formatFullDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }
</script>

<Dialog>
  <!-- 缩略行：整行可点（button 包裹），hover 有背景色反馈。
       基础信息（创建时间 · 评论数）永远显示；assignees/labels/milestone 有值时叠加。 -->
  <DialogTrigger class="hover:bg-accent/60 group flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5 text-left transition-colors">
    <!-- 基础信息：创建时间（永远显示） -->
    <span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <span title={formatFullDate(issue.created_at)}>opened {formatTimeAgo(issue.created_at)}</span>
    </span>
    <span class="text-muted-foreground/40 select-none">·</span>
    <!-- 基础信息：评论数（永远显示） -->
    <span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <MessageCircleIcon class="size-3" />
      <span class="tabular-nums">{issue.comments}</span>
    </span>

    <!-- 有 meta 字段时加分隔符 + meta 区块 -->
    {#if hasMeta}
      <span class="text-muted-foreground/40 select-none">·</span>

      <!-- Assignees：叠加头像 + 计数 -->
      {#if issue.assignees.length > 0}
        <span class="inline-flex items-center gap-1.5">
          <span class="flex -space-x-1.5">
            {#each issue.assignees.slice(0, 3) as a}
              <img
                src={a.avatar_url}
                alt={a.login}
                class="ring-background size-4 rounded-full ring-1"
                loading="lazy"
              />
            {/each}
          </span>
          <span class="text-muted-foreground text-xs">
            {issue.assignees.length} assignee{issue.assignees.length > 1 ? 's' : ''}
          </span>
        </span>
      {/if}

      <!-- Labels：彩色小圆点 + 计数（不显示文字，省空间） -->
      {#if issue.labels.length > 0}
        <span class="inline-flex items-center gap-1.5">
          <span class="flex items-center gap-0.5">
            {#each issue.labels.slice(0, 5) as label}
              <span
                class="size-2.5 rounded-full border"
                style={labelStyleString(label.color)}
                title={label.name}
              ></span>
            {/each}
          </span>
          <span class="text-muted-foreground text-xs">
            {issue.labels.length} label{issue.labels.length > 1 ? 's' : ''}
          </span>
        </span>
      {/if}

      <!-- Milestone：图标 + 标题 -->
      {#if issue.milestone}
        <span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <MilestoneIcon class="size-3.5" />
          <span class="max-w-[180px] truncate">{issue.milestone.title}</span>
        </span>
      {/if}
    {/if}

    <!-- 右侧提示：点击查看详情 -->
    <span class="text-muted-foreground group-hover:text-foreground ml-auto inline-flex items-center gap-1 text-[11px] transition-colors">
      <InfoIcon class="size-3" />
      详情
    </span>
  </DialogTrigger>
    <DialogContent class="max-h-[85dvh] max-w-md overflow-auto">
      <DialogHeader>
        <DialogTitle>Issue 信息</DialogTitle>
        <DialogDescription class="sr-only">查看 issue 的指派人、标签、里程碑等元信息</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Assignees -->
        <div>
          <h3 class="text-muted-foreground mb-2 text-xs font-semibold">Assignees</h3>
          {#if issue.assignees.length > 0}
            <ul class="space-y-1.5">
              {#each issue.assignees as a}
                <li class="flex items-center gap-2">
                  <img
                    src={a.avatar_url}
                    alt={a.login}
                    class="size-5 rounded-full"
                    loading="lazy"
                  />
                  <span class="text-sm">{a.login}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-muted-foreground text-xs">No assignees</p>
          {/if}
        </div>

        <!-- Labels -->
        <div>
          <h3 class="text-muted-foreground mb-2 text-xs font-semibold">Labels</h3>
          {#if issue.labels.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each issue.labels as label}
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                  style={labelStyleString(label.color)}
                >
                  {label.name}
                </span>
              {/each}
            </div>
          {:else}
            <p class="text-muted-foreground text-xs">No labels</p>
          {/if}
        </div>

        <!-- Milestone -->
        <div>
          <h3 class="text-muted-foreground mb-2 text-xs font-semibold">Milestone</h3>
          {#if issue.milestone}
            <a
              href={issue.milestone.html_url ?? issue.html_url}
              target="_blank"
              rel="noopener noreferrer"
              class="hover:bg-accent -mx-1 flex items-center gap-2 rounded px-1 py-1 text-sm transition-colors"
            >
              <MilestoneIcon class="size-4 text-muted-foreground" />
              <span class="flex-1 truncate">{issue.milestone.title}</span>
              <ExternalLinkIcon class="text-muted-foreground size-3" />
            </a>
          {:else}
            <p class="text-muted-foreground text-xs">No milestone</p>
          {/if}
        </div>

        <!-- Participants（从 events 聚合） -->
        {#if participants.length > 0}
          <div>
            <h3 class="text-muted-foreground mb-2 text-xs font-semibold">Participants</h3>
            <ul class="flex flex-wrap gap-2">
              {#each participants as p}
                <li class="flex items-center gap-1.5" title={p.login}>
                  <img
                    src={p.avatar_url}
                    alt={p.login}
                    class="size-5 rounded-full"
                    loading="lazy"
                  />
                  <span class="text-xs">{p.login}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- 时间信息 -->
        <div class="border-border border-t pt-3">
          <dl class="text-muted-foreground space-y-1.5 text-xs">
            <div class="flex items-center justify-between gap-3">
              <dt>创建于</dt>
              <dd class="tabular-nums" title={formatFullDate(issue.created_at)}>{formatTimeAgo(issue.created_at)}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt>更新于</dt>
              <dd class="tabular-nums" title={formatFullDate(issue.updated_at)}>{formatTimeAgo(issue.updated_at)}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="inline-flex items-center gap-1">
                <MessageCircleIcon class="size-3" />
                评论数
              </dt>
              <dd class="tabular-nums">{issue.comments}</dd>
            </div>
          </dl>
        </div>

        <!-- 打开 GitHub 完整页面 -->
        <div class="border-border border-t pt-3">
          <a
            href={issue.html_url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
          >
            <ExternalLinkIcon class="size-3" />
            在 GitHub 查看完整信息
          </a>
        </div>
      </div>
    </DialogContent>
  </Dialog>
