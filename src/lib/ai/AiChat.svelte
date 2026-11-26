<!--
  正交意图：
  1. 原始需求（2026-11）：浏览器内置 AI 可用时，在搜索页提供对话式站内检索。
  2. 面板自身管理会话生命周期：发送/停止、状态提示、引用来源、错误提示。
  3. 中文能力限制如实展示；AI 不可用时由 SearchView 整体不渲染本组件。
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import {
    createSearchAgent,
    type AgentSource,
    type AgentStatus,
    type SearchAgent,
  } from '$lib/ai/agent'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import LoaderIcon from '@lucide/svelte/icons/loader'
  import SendIcon from '@lucide/svelte/icons/send'
  import SparklesIcon from '@lucide/svelte/icons/sparkles'
  import SquareIcon from '@lucide/svelte/icons/square'

  interface ChatMessage {
    id: number
    role: 'user' | 'assistant'
    text: string
  }

  let input = $state('')
  let messages = $state<ChatMessage[]>([])
  let sources = $state<AgentSource[]>([])
  let busy = $state(false)
  let status = $state<AgentStatus | null>(null)
  let error = $state<string | null>(null)
  let scrollEl = $state<HTMLDivElement | null>(null)

  let agent: SearchAgent | null = null
  let agentPromise: Promise<SearchAgent> | null = null
  let controller: AbortController | null = null
  let nextId = 0
  let disposed = false

  const statusText = $derived(
    status === 'searching'
      ? '检索中…'
      : status === 'reading'
        ? '阅读正文…'
        : status === 'finalizing'
          ? '整理回答…'
          : '思考中…',
  )

  async function scrollToBottom(): Promise<void> {
    await tick()
    scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' })
  }

  function ensureAgent(): Promise<SearchAgent> {
    if (agent) return Promise.resolve(agent)
    if (!agentPromise) {
      agentPromise = createSearchAgent({
        onStatus: (next) => {
          status = next
          void scrollToBottom()
        },
        onSources: (next) => {
          sources = [...next]
          void scrollToBottom()
        },
      })
        .then((created) => {
          // 创建期间面板已卸载：立刻释放会话，避免泄漏底层模型。
          if (disposed) {
            created.destroy()
            throw new DOMException('已取消', 'AbortError')
          }
          agent = created
          return created
        })
        .finally(() => {
          agentPromise = null
        })
    }
    return agentPromise
  }

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || busy) return

    input = ''
    error = null
    sources = []
    messages = [...messages, { id: nextId++, role: 'user', text }]
    busy = true
    status = 'thinking'
    void scrollToBottom()

    const current = new AbortController()
    controller = current

    try {
      const activeAgent = await ensureAgent()
      if (current.signal.aborted) return
      const answer = await activeAgent.runTurn(text, current.signal)
      if (current.signal.aborted) return
      messages = [...messages, { id: nextId++, role: 'assistant', text: answer }]
    } catch (cause) {
      if (current.signal.aborted) return
      error = cause instanceof Error ? cause.message : 'AI 请求失败，请稍后再试'
    } finally {
      if (controller === current) {
        controller = null
        busy = false
        status = null
      }
      await scrollToBottom()
    }
  }

  function stop(): void {
    controller?.abort()
    controller = null
    busy = false
    status = null
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    void send()
  }

  function openSource(href: string): void {
    navController.navigateMain(href)
  }

  onDestroy(() => {
    disposed = true
    controller?.abort()
    controller = null
    agent?.destroy()
    agent = null
  })
</script>

<section
  id="ai-chat-panel"
  class="border-border/70 overflow-hidden rounded-xl border"
  aria-label="AI 搜索助手"
  aria-busy={busy}
>
  <header class="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
    <SparklesIcon class="text-primary size-4" />
    <h2 class="text-sm font-medium">AI 助手</h2>
    <span class="text-muted-foreground ml-auto text-[11px]">浏览器内置模型</span>
  </header>

  <div
    bind:this={scrollEl}
    class="max-h-80 min-h-40 overflow-y-auto px-3 py-3 scrollbar-thin scrollbar-track-transparent"
    role="log"
    aria-label="AI 对话记录"
  >
    {#if messages.length === 0 && !busy}
      <div class="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
        <SparklesIcon class="text-muted-foreground size-6" />
        <p class="text-muted-foreground text-sm">AI 会检索站内文章与事件</p>
        <p class="text-muted-foreground/70 text-xs">例如：最近有哪些关于 Rust 的文章？</p>
      </div>
    {:else}
      <ul class="space-y-3">
        {#each messages as message (message.id)}
          <li class="flex" class:justify-end={message.role === 'user'}>
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap"
              class:bg-primary={message.role === 'user'}
              class:text-primary-foreground={message.role === 'user'}
              class:bg-muted={message.role === 'assistant'}
            >
              {message.text}
            </div>
          </li>
        {/each}
        {#if busy}
          <li class="text-muted-foreground flex items-center gap-1.5 text-xs">
            <LoaderIcon class="size-3.5 animate-spin" />
            {statusText}
          </li>
        {/if}
      </ul>
    {/if}

    {#if sources.length > 0}
      <div class="border-border/60 mt-3 border-t pt-2">
        <p class="text-muted-foreground mb-1.5 text-xs">引用结果</p>
        <ul class="flex flex-wrap gap-1.5">
          {#each sources as source (source.id)}
            <li class="max-w-full">
              <a
                class="bg-muted hover:bg-muted/70 inline-flex max-w-full items-center rounded px-2 py-1 text-xs transition-colors"
                href={source.href}
                title={source.title}
                onclick={(event) => {
                  event.preventDefault()
                  openSource(source.href)
                }}
              >
                <span class="truncate">{source.title}</span>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  {#if error}
    <p
      class="border-destructive/30 text-destructive mx-3 mb-2 rounded-md border px-3 py-2 text-sm"
      role="alert"
    >
      {error}
    </p>
  {/if}

  <div class="border-t p-2">
    <div class="flex items-end gap-2">
      <Textarea
        bind:value={input}
        class="bg-input/50 max-h-28 min-h-9 min-w-0 flex-1 rounded-lg px-2.5 py-2 text-sm md:text-sm"
        rows={1}
        placeholder="问点什么，例如：最近关于 Rust 的文章"
        aria-label="向 AI 提问"
        disabled={busy}
        onkeydown={onKeydown}
      />
      {#if busy}
        <Button variant="outline" size="icon-sm" aria-label="停止生成" onclick={stop}>
          <SquareIcon class="size-3.5" />
        </Button>
      {:else}
        <Button size="icon-sm" aria-label="发送" disabled={!input.trim()} onclick={send}>
          <SendIcon class="size-3.5" />
        </Button>
      {/if}
    </div>
    <p class="text-muted-foreground mt-1.5 px-0.5 text-[11px] leading-4">
      内置模型官方支持英/西/日/德/法，中文回答可能不稳定。
    </p>
  </div>
</section>
