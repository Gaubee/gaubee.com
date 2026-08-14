<!--
	CodeMirror 6 Svelte 5 封装。

	关键设计（避免反馈循环）：
	- CodeMirror 拥有 document。用户输入直接更新 CM 内部状态。
	- 外部 `doc` prop 只在"文档身份切换"（docId 变化）时同步进 CM，不在每次按键时回写。
	  避免循环：外部 doc → CM dispatch → onUpdate → 外部 doc → ...
	- 用户编辑通过 onInput 回调通知父组件（父组件可存 IndexedDB，但不应把回写的 doc
	  再传回来触发 CM 重载，除非文档身份变了）。
	- 命令式 API（insertText）：父组件传入 `api` 对象（CodeMirrorApi），组件 onMount 时
	  填充 insertText 方法。用于在光标处插入片段（如图片上传后插入 ![](url)），
	  不触发文档重载、不丢光标位置。
-->

<script lang="ts" module>
  /** CodeMirror 命令式 API（由组件填充，父组件调用）。 */
  export interface CodeMirrorApi {
    /** 在当前光标位置插入文本（不重载文档、不丢光标，光标移到插入内容末尾）。 */
    insertText: (text: string) => void
  }
</script>

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
  import { langByPath } from './lang-by-path'

  let {
    doc = '',
    /** 文档身份标识。变化时强制重载 doc 到 CM（切换文章时用）。 */
    docId = '',
    readonly = false,
    placeholder = '',
    /** 文件路径（GithubEditor 按扩展名选语言）。
     *  不传或为 .md 时用 markdown + WYSIWYG；其它扩展名用对应语言包（无 WYSIWYG）。 */
    filePath = '',
    onInput,
    onSave,
    /** 命令式 API 载体（父组件创建并传入，组件挂载时填充 insertText 方法）。 */
    api,
  }: {
    doc?: string
    docId?: string
    readonly?: boolean
    placeholder?: string
    filePath?: string
    onInput?: (value: string) => void
    onSave?: () => void
    api?: CodeMirrorApi
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

    // 语言选择：filePath 为空或 .md → markdown + WYSIWYG；其它 → 按扩展名选语言包
    const langExt = filePath ? langByPath(filePath) : null
    const isMarkdown = !filePath || filePath.endsWith('.md')
    if (isMarkdown) {
      // Markdown 模式：WYSIWYG 实时预览 + 代码块多语言高亮
      exts.push(
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        markdownPreview(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true })
      )
    } else if (langExt) {
      // 代码文件：按扩展名选语言（ts/js/json/css/html/yaml 等）
      exts.push(langExt, syntaxHighlighting(defaultHighlightStyle, { fallback: true }))
    } else {
      // 未知扩展名：纯文本 + 默认高亮 fallback
      exts.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }))
    }

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
    // 填充命令式 API：在光标处插入文本，dispatch transaction（不重载、不丢光标）
    if (api) {
      api.insertText = (text: string) => {
        if (!view) return
        const sel = view.state.selection.main
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
          scrollIntoView: true,
        })
        view.focus()
      }
    }
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
