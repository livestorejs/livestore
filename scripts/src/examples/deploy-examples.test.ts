import { Option } from '@livestore/utils/effect'
import { describe, expect, test } from 'vitest'

import { resolveAlias } from './deploy-examples.ts'

const toOption = (value: string | undefined) => (value ? Option.some(value) : Option.none<string>())

const makeAlias = ({
  site,
  alias,
  normalizedBranch,
  shortSha,
}: {
  site: string
  alias?: string
  normalizedBranch: string
  shortSha: string
}) =>
  resolveAlias({
    site,
    alias: toOption(alias),
    normalizedBranch,
    shortSha,
  })

describe('resolveAlias', () => {
  test('respects DNS label limit when alias is provided', () => {
    const site = 'example-super-long-web-todomvc-random-dev'
    const alias = 'Feature/This-Is-A-Very-Long-Branch-Name-That-Should-Be-Clamped-To-Fit'

    const resolved = makeAlias({ site, alias, normalizedBranch: 'feature/very-long-branch', shortSha: 'abc1234' })

    expect(resolved.length + site.length + 2).toBeLessThanOrEqual(63)
    expect(resolved.endsWith('-')).toBe(false)
  })

  test('falls back to branch-derived alias when no alias provided', () => {
    const site = 'example-web-todomvc-dev'

    const resolved = makeAlias({ site, normalizedBranch: 'feature/some-update', shortSha: 'abc1234' })

    expect(resolved).toMatch(/^branch-feature-some-update-abc1234/)
    expect(resolved.length + site.length + 2).toBeLessThanOrEqual(63)
  })

  test('sanitizes branch alias when it collapses to minimal value', () => {
    const site = 'example-web-todomvc-dev'
    const resolved = makeAlias({ site, normalizedBranch: '---', shortSha: 'abc1234' })

    expect(resolved).toBe('branch-abc1234')
    expect(resolved.length + site.length + 2).toBeLessThanOrEqual(63)
  })
})
