<!--
	MetadataEditor：frontmatter 表单编辑器（简化版）。

	提供常用字段（title/date/updated/tags）的表单 UI，同时支持切换到原始 YAML 编辑。
	完整的 schema-driven 字段类型系统（text/date/datetime/url/color/object/array + 自定义）
	留到后续迭代。本版本覆盖迁移场景的核心需求。
-->
<script lang="ts">
  import { Textarea } from '$lib/components/ui/textarea'
  import { Input } from '$lib/components/ui/input'
  import { Button } from '$lib/components/ui/button'
  import * as Field from '$lib/components/ui/field'
  import { Badge } from '$lib/components/ui/badge'
  import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
  import CodeIcon from '@lucide/svelte/icons/code'
  import FormInputIcon from '@lucide/svelte/icons/form-input'
  import XIcon from '@lucide/svelte/icons/x'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import { normalizeMetadata, type ArticleMetadata } from '$lib/data/frontmatter'

  let {
    metadata = $bindable(),
    oncommit,
  }: {
    metadata: ArticleMetadata
    oncommit?: () => void
  } = $props()

  let mode = $state<'form' | 'yaml'>('form')
  let yamlText = $state('')
  let newTag = $state('')
  let yamlError = $state<string | null>(null)

  // 进入 yaml 模式时同步
  function switchToYaml() {
    const { preview, previewHTML, ...rest } = metadata as ArticleMetadata & {
      preview?: unknown
      previewHTML?: unknown
    }
    void preview
    void previewHTML
    yamlText = yamlDump(rest, { lineWidth: -1, sortKeys: false })
    yamlError = null
    mode = 'yaml'
  }

  function switchToForm() {
    if (mode === 'yaml') {
      // 尝试解析 yaml 回写到 metadata
      try {
        const parsed = yamlLoad(yamlText) as Record<string, unknown>
        if (parsed && typeof parsed === 'object') {
          applyYamlToMetadata(parsed)
          yamlError = null
        }
      } catch (e) {
        yamlError = e instanceof Error ? e.message : 'YAML 解析失败'
        return // 不切换，让用户修正
      }
    }
    mode = 'form'
  }

  function applyYamlToMetadata(raw: Record<string, unknown>) {
    // 用 frontmatter.ts 的完整 normalizeMetadata 合并，保留所有字段
    // （title/date/updated/tags/scripts/__editor_metadata/passthrough），
    // 避免旧版只回填标准字段导致丢字段（审查 #8）。
    const normalized = normalizeMetadata(raw)
    // 原地清空再赋值，保持 $bindable 的响应式引用
    for (const key of Object.keys(metadata as object)) {
      delete (metadata as Record<string, unknown>)[key]
    }
    Object.assign(metadata, normalized)
  }

  function addTag() {
    const t = newTag.trim()
    if (t && !metadata.tags.includes(t)) {
      metadata.tags = [...metadata.tags, t]
    }
    newTag = ''
  }

  function removeTag(tag: string) {
    metadata.tags = metadata.tags.filter((t) => t !== tag)
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  // 日期输入用 yyyy-MM-ddThh:mm 格式
  function toDateInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function fromDateInput(s: string): Date | undefined {
    if (!s) return undefined
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
</script>

<div class="flex h-full flex-col">
  <!-- 模式切换 -->
  <div class="flex items-center gap-2 border-b border-border p-2">
    <Button
      size="sm"
      variant={mode === 'form' ? 'default' : 'ghost'}
      onclick={() => switchToForm()}
    >
      <FormInputIcon data-icon="inline-start" />
      表单
    </Button>
    <Button
      size="sm"
      variant={mode === 'yaml' ? 'default' : 'ghost'}
      onclick={() => switchToYaml()}
    >
      <CodeIcon data-icon="inline-start" />
      YAML
    </Button>
  </div>

  {#if mode === 'form'}
    <div class="flex-1 overflow-auto p-4">
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="meta-title">标题</Field.FieldLabel>
          <Input
            id="meta-title"
            type="text"
            value={metadata.title ?? ''}
            oninput={(e) => (metadata.title = e.currentTarget.value)}
            placeholder="（可选，缺失时从正文推导）"
          />
        </Field.Field>

        <Field.Field>
          <Field.FieldLabel for="meta-date">创建日期</Field.FieldLabel>
          <Input
            id="meta-date"
            type="datetime-local"
            value={toDateInput(metadata.date)}
            oninput={(e) => {
              const d = fromDateInput(e.currentTarget.value)
              if (d) metadata.date = d
            }}
          />
        </Field.Field>

        <Field.Field>
          <Field.FieldLabel for="meta-updated">更新日期</Field.FieldLabel>
          <Input
            id="meta-updated"
            type="datetime-local"
            value={metadata.updated ? toDateInput(metadata.updated) : ''}
            oninput={(e) => {
              const d = fromDateInput(e.currentTarget.value)
              metadata.updated = d
            }}
          />
        </Field.Field>

        <Field.Field>
          <Field.FieldLabel for="meta-tag-input">标签</Field.FieldLabel>
          <div class="flex flex-wrap gap-1.5">
            {#each metadata.tags as tag (tag)}
              <Badge variant="secondary" class="gap-1 pr-1">
                {tag}
                <button
                  type="button"
                  class="hover:text-destructive rounded-sm"
                  onclick={() => removeTag(tag)}
                  aria-label="移除标签"
                >
                  <XIcon class="size-3" />
                </button>
              </Badge>
            {/each}
          </div>
          <div class="mt-1.5 flex gap-1.5">
            <Input
              id="meta-tag-input"
              type="text"
              value={newTag}
              oninput={(e) => (newTag = e.currentTarget.value)}
              onkeydown={handleTagKeydown}
              placeholder="输入标签后回车"
              class="flex-1"
            />
            <Button size="icon" onclick={addTag} aria-label="添加标签">
              <PlusIcon />
            </Button>
          </div>
        </Field.Field>
      </Field.FieldGroup>

      {#if Object.keys(metadata).filter((k) => !['title', 'date', 'updated', 'tags'].includes(k)).length > 0}
        <p class="text-muted-foreground mt-4 text-xs">
          其他字段（scripts、__editor_metadata 等）请切换 YAML 模式编辑。
        </p>
      {/if}
    </div>
  {:else}
    <div class="flex-1 overflow-auto p-2">
      <Textarea
        bind:value={yamlText}
        class="min-h-[60vh] font-mono text-xs"
        oninput={() => (yamlError = null)}
      />
      {#if yamlError}
        <p class="text-destructive mt-2 text-xs">{yamlError}</p>
      {/if}
    </div>
  {/if}
</div>
