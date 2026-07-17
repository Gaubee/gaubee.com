/**
 * 一次性迁移脚本：清理 src/content 下所有 markdown frontmatter 里的 preview/previewHTML 字段。
 *
 * 旧 Astro 项目构建时会把 previewHTML 写进 frontmatter，新编辑器项目由预览管线
 * 运行时重建，不需要持久化这些字段。运行后这些字段会被移除，文章的 title/date/
 * updated/tags/scripts/__editor_metadata 保留。
 *
 * 用法：pnpm tsx scripts/migrate-preview-html.ts
 *
 * 幂等：多次运行无副作用（没有这些字段就不动）。
 * 运行后可删除本脚本。
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdown, serializeMarkdown } from '../src/lib/data/frontmatter'

/** 递归列出目录下所有 .md 文件。 */
function listMarkdownFiles(dir: string): string[] {
  const result: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      result.push(...listMarkdownFiles(full))
    } else if (name.endsWith('.md')) {
      result.push(full)
    }
  }
  return result
}

const files = listMarkdownFiles('src/content')
console.log(`扫描 ${files.length} 个 markdown 文件`)

let modified = 0
let skipped = 0

for (const file of files) {
  const raw = readFileSync(file, 'utf-8')
  const { metadata, body } = parseMarkdown(raw)

  if (!metadata) {
    skipped++
    continue
  }

  // serializeMarkdown 会自动剥离 preview/previewHTML
  const newContent = serializeMarkdown(metadata, body)
  if (newContent !== raw) {
    writeFileSync(file, newContent, 'utf-8')
    console.log(`  清理: ${file}`)
    modified++
  } else {
    skipped++
  }
}

console.log(`\n完成：修改 ${modified} 个，跳过 ${skipped} 个`)
