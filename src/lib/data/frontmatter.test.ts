/**
 * Frontmatter 解析/序列化单元测试。
 * 覆盖：解析标准 frontmatter、序列化往返、id 解析、passthrough 透传。
 */
import { describe, expect, it } from 'vitest'
import {
  inferCollection,
  parseArticleId,
  parseMarkdown,
  serializeMarkdown,
} from './frontmatter'

describe('parseMarkdown', () => {
  it('解析标准 frontmatter + body', () => {
    const raw = `---
title: 测试标题
date: 2025-04-09T08:13:05.795Z
tags:
  - article
  - javascript
---

正文内容`
    const { metadata, body, rawFrontmatter } = parseMarkdown(raw)
    expect(metadata).not.toBeNull()
    expect(metadata!.title).toBe('测试标题')
    expect(metadata!.date).toBeInstanceOf(Date)
    expect(metadata!.tags).toEqual(['article', 'javascript'])
    expect(body.trim()).toBe('正文内容')
    expect(rawFrontmatter).toContain('---')
  })

  it('无 frontmatter 时 metadata 为 null', () => {
    const raw = '纯正文，没有 frontmatter'
    const { metadata, body } = parseMarkdown(raw)
    expect(metadata).toBeNull()
    expect(body).toBe(raw)
  })

  it('passthrough 透传额外字段', () => {
    const raw = `---
title: 带 extra
date: 2025-01-01T00:00:00.000Z
customField: hello
scripts:
  - /bundle/x.js
__editor_metadata:
  title:
    type: text
    isArray: false
    order: 0
    description: 标题
---

正文`
    const { metadata } = parseMarkdown(raw)
    expect(metadata!.customField).toBe('hello')
    expect(metadata!.scripts).toEqual(['/bundle/x.js'])
    expect(metadata!.__editor_metadata).toBeDefined()
    expect(metadata!.__editor_metadata!.title.type).toBe('text')
  })

  it('剥离 preview/previewHTML 字段', () => {
    const raw = `---
title: 旧文章
date: 2025-01-01T00:00:00.000Z
preview: 旧的预览
previewHTML: <p>旧HTML</p>
---

正文`
    const { metadata } = parseMarkdown(raw)
    // 解析时仍能读到（passthrough），但序列化时剥离
    expect(metadata).not.toBeNull()
    const serialized = serializeMarkdown(metadata!, '正文')
    expect(serialized).not.toContain('preview')
    expect(serialized).not.toContain('previewHTML')
    expect(serialized).toContain('title: 旧文章')
  })

  it('更新时间 updated 可选', () => {
    const raw = `---
date: 2025-01-01T00:00:00.000Z
updated: 2025-06-01T12:00:00.000Z
---

x`
    const { metadata } = parseMarkdown(raw)
    expect(metadata!.updated).toBeInstanceOf(Date)
  })
})

describe('serializeMarkdown 往返', () => {
  it('解析→序列化→再解析 保持关键数据', () => {
    const original = `---
title: 往返测试
date: 2025-03-15T10:30:00.000Z
tags:
  - test
  - svelte
---

## 标题

正文段落`
    const { metadata, body } = parseMarkdown(original)
    expect(metadata).not.toBeNull()
    const serialized = serializeMarkdown(metadata!, body)
    const { metadata: meta2, body: body2 } = parseMarkdown(serialized)
    expect(meta2!.title).toBe('往返测试')
    expect(meta2!.tags).toEqual(['test', 'svelte'])
    expect(meta2!.date.toISOString()).toBe('2025-03-15T10:30:00.000Z')
    expect(body2.trim()).toBe('## 标题\n\n正文段落')
  })
})

describe('parseArticleId', () => {
  it('标准格式：序号.slug', () => {
    const id = parseArticleId('0057.tc39-signals.md')
    expect(id.seq).toBe('0057')
    expect(id.slug).toBe('tc39-signals')
    expect(id.stem).toBe('0057.tc39-signals')
  })

  it('纯数字（老文章）', () => {
    const id = parseArticleId('0066.md')
    expect(id.seq).toBe('0066')
    expect(id.slug).toBe('')
  })

  it('无扩展名', () => {
    const id = parseArticleId('0057.tc39-signals')
    expect(id.seq).toBe('0057')
    expect(id.stem).toBe('0057.tc39-signals')
  })
})

describe('inferCollection', () => {
  it('4 位序号 → articles', () => {
    expect(inferCollection('0057')).toBe('articles')
    expect(inferCollection('0001')).toBe('articles')
  })

  it('5 位序号 → events', () => {
    expect(inferCollection('00001')).toBe('events')
    expect(inferCollection('00021')).toBe('events')
  })
})
