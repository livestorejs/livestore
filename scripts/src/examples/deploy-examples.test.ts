import { Option } from '@livestore/utils/effect'
import { describe, expect, test } from 'vitest'

import { createPreviewAlias } from '../shared/cloudflare.ts'

const toOption = (value: string | undefined) => (value ? Option.some(value) : Option.none<string>())

const makeAlias = ({ alias, branch, shortSha }: { alias?: string; branch: string; shortSha: string }) =>
  createPreviewAlias({
    branch,
    shortSha,
    explicitAlias: toOption(alias),
  })

describe('createPreviewAlias', () => {
  test('uses explicit alias when provided, clamping to DNS label length', () => {
    const resolved = makeAlias({
      alias: 'Feature/This-Is-A-Very-Long-Branch-Name-That-Should-Be-Clamped-To-Fit',
      branch: 'feature/very-long-branch',
      shortSha: 'abc1234',
    })

    expect(resolved.length).toBeLessThanOrEqual(63)
    expect(resolved.endsWith('-')).toBe(false)
    expect(/^[a-z0-9-]+$/.test(resolved)).toBe(true)
  })

  test('falls back to branch-derived alias when none is provided', () => {
    const resolved = makeAlias({ branch: 'feature/some-update', shortSha: 'abc1234' })

    expect(resolved).toMatch(/^branch-feature-some-update-abc1234/)
    expect(resolved.length).toBeLessThanOrEqual(63)
  })

  test('collapses unsafe values to short SHA', () => {
    const resolved = makeAlias({ branch: '---', shortSha: 'abc1234' })

    expect(resolved).toBe('branch-abc1234')
  })
})
