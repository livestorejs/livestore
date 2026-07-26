import { describe, expect, it } from 'vitest'

import { Effect, Exit, Schema } from '@livestore/utils/effect'

import { blocking, expiredEntries, QuarantineEntry, quarantineLedger, runTestTarget } from './test-policy.ts'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

const today = (): string => new Date().toISOString().slice(0, 10)

const decodeEntry = Schema.decodeUnknownExit(QuarantineEntry)

describe('quarantine ledger', () => {
  it('has no expired entries', () => {
    // A quarantine past its expiry reds `test-unit` rather than quietly becoming permanent.
    // Renew it with a new date and a fresh justification, or delete it.
    expect(expiredEntries(quarantineLedger, today())).toEqual([])
  })

  it('flags a lapsed entry and leaves a live one alone', () => {
    const lapsed = new QuarantineEntry({
      target: 'packages/@livestore/example',
      reason: 'demonstrates the expiry rule',
      issue: 'https://github.com/livestorejs/livestore/issues/1404',
      expires: '2020-01-01',
    })
    const live = new QuarantineEntry({ ...lapsed, expires: '2999-01-01' })

    expect(expiredEntries({ lapsed, live }, today()).map(([key]) => key)).toEqual(['lapsed'])
  })

  it('treats a malformed expiry as expired rather than never-expiring', () => {
    // Lexicographic comparison would sort 'someday' above every real date, so a typo would
    // otherwise create a permanent quarantine.
    const malformed = new QuarantineEntry({
      target: 'packages/@livestore/example',
      reason: 'typo in the expiry',
      issue: 'https://github.com/livestorejs/livestore/issues/1404',
      expires: 'someday',
    })

    expect(expiredEntries({ malformed }, today()).map(([key]) => key)).toEqual(['malformed'])
  })

  it('rejects a malformed entry', () => {
    // Exercises the decode used by the shape check above, which otherwise never runs while
    // the ledger is empty — an unexercised assertion is the failure mode this PR exists to stop.
    expect(Exit.isSuccess(decodeEntry({ target: 'x', reason: 'y', issue: 'z', expires: '2999-01-01' }))).toBe(true)
    expect(Exit.isSuccess(decodeEntry({ target: 'x', reason: 'y', issue: 'z' }))).toBe(false)
  })

  it('records a target, reason, issue and a well-formed expiry for every entry', () => {
    for (const [key, entry] of Object.entries(quarantineLedger as Record<string, QuarantineEntry>)) {
      expect(Exit.isSuccess(decodeEntry(entry)), `${key} shape`).toBe(true)
      expect(entry.issue, `${key} issue`).toMatch(/^https:\/\/github\.com\//)
      expect(entry.expires, `${key} expires`).toMatch(isoDate)
      expect(entry.reason.length, `${key} reason`).toBeGreaterThan(0)
    }
  })
})

describe('runTestTarget', () => {
  it('propagates failure under the blocking policy', async () => {
    const exit = await Effect.runPromiseExit(
      runTestTarget({ label: 'demo', policy: blocking, run: Effect.fail('boom' as const) }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('passes success through under the blocking policy', async () => {
    const exit = await Effect.runPromiseExit(
      runTestTarget({ label: 'demo', policy: blocking, run: Effect.succeed('ok' as const) }),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it('refuses a quarantine key with no ledger entry', () => {
    // The type checker rejects this statically; a cast or a JS caller can still reach it, and
    // treating an unknown quarantine as "suppress everything" is the failure mode to avoid.
    expect(() =>
      runTestTarget({ label: 'packages/@livestore/unrelated', policy: fakePolicy(), run: Effect.void }),
    ).toThrow(/has no entry in the ledger/)
  })

  it('refuses a real quarantine applied to a target it does not declare', () => {
    const [key, entry] = Object.entries(quarantineLedger as Record<string, QuarantineEntry>)[0] ?? []
    if (key === undefined || entry === undefined) return

    expect(() =>
      runTestTarget({ label: `${entry.target}-but-not-really`, policy: fakePolicy(key), run: Effect.void }),
    ).toThrow(/declares target/)
  })

  it('swallows a failure for a correctly declared quarantine', async () => {
    // The mechanism's whole point. Without this, dropping the `Effect.ignore` would pass the suite.
    const [key, entry] = Object.entries(quarantineLedger as Record<string, QuarantineEntry>)[0] ?? []
    if (key === undefined || entry === undefined) return

    const exit = await Effect.runPromiseExit(
      runTestTarget({ label: entry.target, policy: fakePolicy(key), run: Effect.fail('boom' as const) }),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
  })
})

/** A quarantine policy the type checker would reject, to reach the runtime guards. */
const fakePolicy = (key = 'demo-entry'): Parameters<typeof runTestTarget>[0]['policy'] =>
  ({ _tag: 'quarantined', key }) as unknown as Parameters<typeof runTestTarget>[0]['policy']
