<!--
	GeoRulesView：cdn-media 地区路由规则的后台配置页（/app/geo-rules，Phase 2 / R5）。

	正交意图：
	1. [2026-10-07] owner 查看/编辑当前 geo 规则（JSON textarea + 前端 schema 校验 + PUT 保存），
	   回显访客视角的 /api/geo 解析结果。朴素可用优先，不做美观打磨。
	2. owner 判定与 EventView 同源（login === OWNER，大小写不敏感）。
	3. token 沿用站点既有会话（authStore 内存 token，走 Bearer；R5：前端 OAuth 无 worker session，不复用 cookie）。
-->
<script lang="ts">
  import { authStore } from '$lib/auth/session.svelte'
  // 契约与校验：worker 共用同一份 src/lib/geo/contract.ts
  import { DEFAULT_GEO_RULES, validateGeoRules, type GeoResponse, type GeoRules } from '$lib/geo/contract'
  import { OWNER } from '$lib/github/client'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import GlobeIcon from '@lucide/svelte/icons/globe'

  const isOwner = $derived(
    !!authStore.state.user && authStore.state.user.login.toLowerCase() === OWNER.toLowerCase(),
  )

  let rulesText = $state('')
  let rulesMeta = $state<{ fromDefault: boolean } | null>(null)
  let visitorGeo = $state<GeoResponse | null>(null)

  type Phase = 'loading' | 'ready' | 'saving'
  let phase = $state<Phase>('loading')
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)

  /** 文本实时校验结果（编辑期间只提示，不阻塞输入）。 */
  const validation = $derived.by(() => {
    if (!rulesText.trim()) return null
    try {
      const parsed = validateGeoRules(JSON.parse(rulesText))
      return parsed.ok ? { ok: true as const } : { ok: false as const, error: parsed.error }
    } catch (e) {
      return { ok: false as const, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
    }
  })

  function authHeaders(extra?: HeadersInit): HeadersInit {
    const headers = new Headers(extra)
    if (authStore.apiToken) headers.set('Authorization', `Bearer ${authStore.apiToken}`)
    return headers
  }

  async function load(): Promise<void> {
    phase = 'loading'
    message = null
    try {
      const [rulesResp, geoResp] = await Promise.all([
        fetch('/api/geo/rules', { headers: authHeaders() }),
        fetch('/api/geo'),
      ])
      if (rulesResp.ok) {
        const data = (await rulesResp.json()) as { rules: GeoRules; fromDefault: boolean }
        rulesText = JSON.stringify(data.rules, null, 2)
        rulesMeta = { fromDefault: data.fromDefault }
        phase = 'ready'
      } else {
        message = { kind: 'error', text: `读取规则失败（${rulesResp.status}）` }
        phase = 'ready'
      }
      if (geoResp.ok) visitorGeo = (await geoResp.json()) as GeoResponse
    } catch (e) {
      message = { kind: 'error', text: `worker 不可达：${e instanceof Error ? e.message : String(e)}` }
      phase = 'ready'
    }
  }

  async function save(): Promise<void> {
    if (!validation?.ok) return
    phase = 'saving'
    message = null
    try {
      const resp = await fetch('/api/geo/rules', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: rulesText,
      })
      if (resp.ok) {
        // 先重载（会清旧 message）再写成功反馈，避免被 load 抹掉
        await load()
        message = { kind: 'ok', text: '已保存（KV 落库；公读缓存 60s + 前端缓存 10min 内全网生效）' }
      } else {
        const data = (await resp.json().catch(() => ({}))) as { error?: string }
        message = { kind: 'error', text: `保存失败（${resp.status}）：${data.error ?? resp.statusText}` }
      }
    } catch (e) {
      message = { kind: 'error', text: `worker 不可达：${e instanceof Error ? e.message : String(e)}` }
    } finally {
      phase = 'ready'
    }
  }

  $effect(() => {
    if (isOwner && phase === 'loading' && !rulesText) void load()
  })
</script>

<div class="mx-auto max-w-3xl px-4 py-8">
  <header class="mb-6 flex items-center gap-3">
    <div class="bg-primary/10 flex size-10 items-center justify-center rounded-lg">
      <GlobeIcon class="text-primary size-5" />
    </div>
    <div class="min-w-0">
      <h1 class="text-xl font-bold">Geo 地区路由规则</h1>
      <p class="text-muted-foreground text-sm">
        cdn-media 媒体引用按访客地区重写 mediaBase（/api/geo）。默认同源（空串）= 不重写。
      </p>
    </div>
  </header>

  {#if !authStore.state.loaded}
    <p class="text-muted-foreground text-sm">会话检查中…</p>
  {:else if !isOwner}
    <div class="text-muted-foreground rounded-lg border p-4 text-sm">
      仅站点 Owner（{OWNER}）可管理 geo 规则。
      {#if !authStore.isAuthenticated}
        <button class="hover:text-foreground underline" onclick={() => authStore.login()}>登录</button>
      {/if}
    </div>
  {:else}
    {#if visitorGeo}
      <div class="bg-muted/40 mb-4 rounded-lg border p-3 text-sm">
        访客视角解析：<code class="font-mono">mediaBase="{visitorGeo.mediaBase || '（同源）'}"</code>
        <span class="text-muted-foreground">ruleVersion={visitorGeo.ruleVersion}</span>
      </div>
    {/if}

    {#if rulesMeta?.fromDefault}
      <p class="text-muted-foreground mb-2 text-xs">
        当前为内置默认规则（KV 无配置）——保存一次即落库。
      </p>
    {/if}

    <Textarea
      class="min-h-72 font-mono text-xs"
      spellcheck="false"
      placeholder={JSON.stringify(DEFAULT_GEO_RULES, null, 2)}
      bind:value={rulesText}
      disabled={phase === 'saving'}
      aria-label="geo 规则 JSON"
    ></Textarea>

    {#if validation && !validation.ok}
      <p class="mt-2 text-sm text-red-600 dark:text-red-400">{validation.error}</p>
    {:else if validation?.ok}
      <p class="mt-2 text-sm text-green-600 dark:text-green-400">schema 校验通过</p>
    {/if}

    {#if message}
      <p class="mt-2 text-sm {message.kind === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
        {message.text}
      </p>
    {/if}

    <div class="mt-4 flex gap-2">
      <Button onclick={save} disabled={!validation?.ok || phase === 'saving'}>
        {phase === 'saving' ? '保存中…' : '保存规则'}
      </Button>
      <Button variant="outline" onclick={load} disabled={phase === 'saving'}>重新加载</Button>
    </div>

    <details class="text-muted-foreground mt-6 text-xs">
      <summary class="cursor-pointer">规则 schema 说明</summary>
      <pre class="mt-2 overflow-auto rounded border p-3 font-mono">{`{
  version: number          // 递增，前端缓存 key 携带
  rules: [{                // 声明顺序即优先级
    match: {
      countries?: ["CN"]   // ISO 3166-1 alpha-2，大写
      continents?: ["AS"]  // AF/AN/AS/EU/NA/OC/SA
      default?: true       // 兜底，放最后
    }
    mediaBase: ""          // 空串=同源（不重写）；或 http(s) origin（不带路径）
  }]
}`}</pre>
    </details>
  {/if}
</div>
