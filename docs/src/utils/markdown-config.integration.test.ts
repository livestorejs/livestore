import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { expect, it } from 'vitest'

import { markdownOptions } from './markdown-config.ts'

it('renders changelog text and headings without loading a frontmatter layout', async () => {
  const processor = await createMarkdownProcessor(markdownOptions)
  const rendered = await processor.render(`---
layout: ./does-not-exist.astro
---

## Release notes

A change with [an external reference](https://example.com).
`)

  expect(rendered.metadata.headings).toContainEqual({ depth: 2, slug: 'release-notes', text: 'Release notes' })
  expect(rendered.code).toContain('<h2 id="release-notes">Release notes</h2>')
  expect(rendered.code).toContain('https://example.com')
})
