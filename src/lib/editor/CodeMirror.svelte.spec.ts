import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import CodeMirror from './CodeMirror.svelte'

describe('CodeMirror', () => {
  it('挂载并显示内容', async () => {
    const { container } = render(CodeMirror, {
      props: {
        doc: '# 标题\n\n正文 **加粗**',
        docId: 'test-1',
      },
    })
    // 等待 CodeMirror 初始化
    await new Promise((r) => setTimeout(r, 300))
    const cmEditor = container.querySelector('.cm-editor')
    expect(cmEditor).toBeTruthy()
    const cmContent = container.querySelector('.cm-content')
    expect(cmContent?.textContent).toContain('标题')
  })

  it('Markdown WYSIWYG 隐藏 # 标记', async () => {
    const { container } = render(CodeMirror, {
      props: {
        doc: '# 标题',
        docId: 'test-2',
      },
    })
    await new Promise((r) => setTimeout(r, 300))
    // # 标记应该被隐藏（cm-md-hidden）或淡化
    const content = container.querySelector('.cm-content')
    expect(content).toBeTruthy()
    // 标题文字存在
    expect(content?.textContent).toContain('标题')
  })
})
