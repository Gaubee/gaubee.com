<!--
	CodeMirror 6 Svelte 5 封装。

	关键设计（避免反馈循环）：
	- CodeMirror 拥有 document。用户输入直接更新 CM 内部状态。
	- 外部 `doc` prop 只在"文档身份切换"（docId 变化）时同步进 CM，不在每次按键时回写。
	  避免循环：外部 doc → CM dispatch → onUpdate → 外部 doc → ...
	- 用户编辑通过 onInput 回调通知父组件（父组件可存 IndexedDB，但不应把回写的 doc
	  再传回来触发 CM 重载，除非文档身份变了）。
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { EditorState, type Extension } from '@codemirror/state'
  import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'
  import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
  import { tags as t } from '@lezer/highlight'
  import { markdownPreview } from './markdown-wysiwyg'

  let {
    doc = '',
    /** 文档身份标识。变化时强制重载 doc 到 CM（切换文章时用）。 */
    docId = '',
    readonly = false,
    placeholder = '',
    onInput,
    onSave,
  }: {
    doc?: string
    docId?: string
    readonly?: boolean
    placeholder?: string
    onInput?: (value: string) => void
    onSave?: () => void
  } = $props()

  let host: HTMLDivElement
  let view: EditorView | null = null
  let currentDoc = ''
  let currentDocId = $state('')

  /** 自定义亮色主题，跟随应用 luma 配色（语义变量）。 */
  const editorTheme = EditorView.theme({
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--foreground)',
    },
    '.cm-content': {
      caretColor: 'var(--primary)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--primary)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--muted-foreground)',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--muted) 50%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
    },
  })

  /** 简化语法高亮（代码块用语义色）。 */
  const editorHighlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: 'var(--primary)' },
    { tag: [t.string, t.special(t.string)], color: 'oklch(0.55 0.15 145)' },
    { tag: [t.number, t.bool, t.null], color: 'oklch(0.55 0.18 50)' },
    { tag: t.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
    { tag: t.variableName, color: 'var(--foreground)' },
    { tag: t.function(t.variableName), color: 'oklch(0.5 0.2 280)' },
  ])

  function buildExtensions(): Extension[] {
    const exts: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorState.readOnly.of(readonly),
      editorTheme,
      syntaxHighlighting(editorHighlightStyle),
    ]
    if (placeholder) exts.push(cmPlaceholder(placeholder))

    // Markdown 语言 + WYSIWYG 实时预览
    exts.push(
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      markdownPreview(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true })
    )

    // 保存快捷键
    if (onSave) {
      exts.push(
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSave()
              return true
            },
          },
        ])
      )
    }

    return exts
  }

  function createState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        ...buildExtensions(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            currentDoc = update.state.doc.toString()
            onInput?.(currentDoc)
          }
        }),
      ],
    })
  }

  onMount(() => {
    currentDoc = doc
    currentDocId = docId
    view = new EditorView({
      state: createState(currentDoc),
      parent: host,
    })
  })

  onDestroy(() => {
    view?.destroy()
    view = null
  })

  // 文档身份切换时重载（切换文章）
  $effect(() => {
    if (!view) return
    if (docId !== currentDocId) {
      currentDocId = docId
      currentDoc = doc
      view.setState(createState(doc))
    }
  })
</script>

<div class="codemirror-host h-full overflow-auto" bind:this={host}></div>

<style>
  :global(.codemirror-host .cm-editor) {
    height: 100%;
    font-size: 15px;
  }
  :global(.codemirror-host .cm-editor .cm-scroller) {
    font-family: var(--font-mono, ui-monospace, monospace);
    line-height: 1.7;
    padding: 1rem 1.5rem;
  }
  :global(.codemirror-host .cm-editor.cm-focused) {
    outline: none;
  }
  :global(.codemirror-host .cm-editor .cm-content) {
    max-width: 72ch;
    margin: 0 auto;
    padding-bottom: 40vh;
  }
</style>
