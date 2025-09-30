import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildSnippetBundle } from './snippet-graph.ts'

const fixturePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

describe('buildSnippetBundle', () => {
  it('collects main file, imports, and triple-slash references with stable ordering', () => {
    const entryFile = fixturePath('./test-fixtures/snippets/basic/main.ts')

    const bundle = buildSnippetBundle({ entryFilePath: entryFile })

    expect(bundle.mainFileRelativePath).toBe('basic/main.ts')
    expect(bundle.files.map((file) => file.relativePath)).toStrictEqual([
      'basic/main.ts',
      'basic/ambient.d.ts',
      'basic/utils.ts',
      'shared/helper.ts',
    ])
    expect(bundle.files[0]?.isMain).toBe(true)
    for (const file of bundle.files) {
      expect(typeof file.content).toBe('string')
      expect(file.content.length).toBeGreaterThan(0)
    }
  })

  it('ignores unresolved relative imports without throwing', () => {
    const entryFile = fixturePath('./test-fixtures/snippets/missing/main.ts')

    const bundle = buildSnippetBundle({ entryFilePath: entryFile })

    expect(bundle.files.map((file) => file.relativePath)).toStrictEqual(['missing/main.ts'])
    expect(bundle.files[0]?.isMain).toBe(true)
  })
})
