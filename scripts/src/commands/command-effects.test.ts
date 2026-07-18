import { describe, expect, it } from 'vitest'

import { Effect } from '@livestore/utils/effect'

import { exportMarkdown } from './docs-export.ts'
import { packSnapshot, releaseSnapshot } from './release.ts'

describe('command Effect operations', () => {
  it('exposes markdown export as a lazy Effect with plain-value options', () => {
    const operation = exportMarkdown({
      out: '/tmp/livestore-docs',
      includeLlms: true,
      workspaceRoot: '/tmp/livestore',
    })

    expect(Effect.isEffect(operation)).toBe(true)
  })

  it('exposes snapshot release as a lazy Effect with plain-value options', () => {
    const operation = releaseSnapshot({
      cwd: '/tmp/livestore',
      gitSha: 'abc123',
      version: '0.0.0-snapshot-abc123',
      dryRun: true,
      yes: true,
      tscBin: 'tsc',
    })

    expect(Effect.isEffect(operation)).toBe(true)
  })

  it('exposes snapshot packing as a lazy Effect without publishing options', () => {
    const operation = packSnapshot({
      cwd: '/tmp/livestore',
      gitSha: 'a'.repeat(40),
      outDir: '/tmp/livestore-snapshot',
      tscBin: 'tsc',
    })

    expect(Effect.isEffect(operation)).toBe(true)
  })
})
