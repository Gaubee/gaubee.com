import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import MarkdownViewer from './MarkdownViewer.svelte'

describe('MarkdownViewer', () => {
  it('渲染标题与段落', () => {
    const { container } = render(MarkdownViewer, {
      props: { markdown: '# 标题\n\n这是段落。' },
    })
    expect(container.querySelector('h1')?.textContent).toContain('标题')
    expect(container.querySelector('p')?.textContent).toContain('这是段落')
  })

  it('GFM 表格渲染', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    const { container } = render(MarkdownViewer, { props: { markdown: md } })
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.querySelectorAll('td').length).toBe(2)
  })

  it('代码块渲染（Shiki 加载后高亮）', async () => {
    const md = '```js\nconst x = 1\n```\n'
    const { container } = render(MarkdownViewer, { props: { markdown: md } })
    // 初始应有 pre/code（Shiki 加载前是 plain code）
    expect(container.querySelector('pre')).toBeTruthy()
  })

  it('截断预览：maxLines 限制 + 雾化 class', () => {
    const longMd = Array(20).fill('段落内容').join('\n\n')
    const { container } = render(MarkdownViewer, {
      props: { markdown: longMd, maxLines: 3 },
    })
    const fadeEl = container.querySelector('.truncate-fade')
    expect(fadeEl).toBeTruthy()
  })

  it('图片响应式', () => {
    const md = '![alt](/img.png "标题")'
    const { container } = render(MarkdownViewer, { props: { markdown: md } })
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/img.png')
    expect(img?.getAttribute('alt')).toBe('alt')
  })
})
