import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Effect, Exit } from '@livestore/utils/effect'

import {
  blocking,
  type QuarantineKey,
  quarantineLedger,
  quarantineLedgerJsonPath,
  quarantined,
  runTestTarget,
} from './test-policy.ts'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

describe('quarantine ledger', () => {
  it('records a target, reason, issue and a well-formed expiry for every entry', () => {
    // `ci-tools quarantine validate` enforces this in CI against the generated JSON. Asserting
    // it here too keeps a malformed entry from reaching that check as a confusing failure.
    for (const [key, entry] of Object.entries(quarantineLedger)) {
      expect(entry.target, `${key}.target`).not.toBe('')
      expect(entry.reason, `${key}.reason`).not.toBe('')
      expect(entry.issue, `${key}.issue`).toMatch(/^https:\/\/github\.com\//)
      expect(entry.expires, `${key}.expires`).toMatch(isoDate)
    }
  })

  it('stays in sync with the generated JSON the CLI reads', () => {
    // The TS module is the source of truth and the JSON is generated from it, so a drifted
    // artifact would quarantine one set of targets in the type system and another in CI.
    expect(JSON.parse(fs.readFileSync(quarantineLedgerJsonPath, 'utf8'))).toEqual(quarantineLedger)
  })
})

describe('runTestTarget', () => {
  afterEach(() => restorePath())

  it('propagates failure under the blocking policy', async () => {
    const exit = await Effect.runPromiseExit(
      runTestTarget({ label: 'demo', policy: blocking, run: Effect.fail('boom' as const) }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('passes success through under the blocking policy', async () => {
    const exit = await Effect.runPromiseExit(runTestTarget({ label: 'demo', policy: blocking, run: Effect.succeed(1) }))

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it('swallows a declared quarantine failure, and announces it with the ledger entry', async () => {
    // The mechanism's whole point. The stub stands in for the real `ci-tools` so the wiring —
    // argv, ledger path, key, label — is exercised without depending on the binary being built.
    const { key, entry } = firstLedgerEntry()
    const calls = stubCiTools({ exitCode: 0 })

    const exit = await Effect.runPromiseExit(
      runTestTarget({ label: entry.target, policy: quarantined(key), run: Effect.fail('boom' as const) }),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(calls()).toEqual([
      ['quarantine', 'announce', '--ledger', quarantineLedgerJsonPath, '--key', key, '--label', entry.target],
    ])
  })

  it('fails when the announcement does, rather than tolerating a failure with no signal', async () => {
    // Losing the signal while still suppressing the failure is the outcome the whole mechanism
    // exists to prevent, so a broken announcer must be loud.
    const { key, entry } = firstLedgerEntry()
    const calls = stubCiTools({ exitCode: 1 })

    const exit = await Effect.runPromiseExit(
      runTestTarget({ label: entry.target, policy: quarantined(key), run: Effect.fail('boom' as const) }),
    )

    // Asserting the stub actually ran matters: `ci-tools` is absent from a bare checkout, so
    // without this the test would also pass on a spawn ENOENT — including if `Effect.ignore`
    // were deleted outright. It has to prove "non-zero announcer exit ⇒ fatal", not merely
    // "announcing didn't succeed ⇒ fatal".
    expect(calls()).toHaveLength(1)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('does not reach the announcer for a blocking target', () => {
    const calls = stubCiTools({ exitCode: 0 })

    Effect.runSyncExit(runTestTarget({ label: 'demo', policy: blocking, run: Effect.fail('boom' as const) }))

    expect(calls()).toEqual([])
  })
})

let originalPath: string | undefined

/** The ledger is non-empty by construction; a quarantine test with nothing to test is a bug. */
const firstLedgerEntry = () => {
  const key = (Object.keys(quarantineLedger) as QuarantineKey[])[0]
  if (key === undefined) throw new Error('quarantineLedger is empty; these tests need an entry to exercise.')
  return { key, entry: quarantineLedger[key] }
}

/**
 * Puts a fake `ci-tools` on `PATH` that records its argv, so the announce path can be tested
 * without the real binary. Returns a reader for the recorded invocations.
 */
const stubCiTools = ({ exitCode }: { readonly exitCode: number }): (() => readonly string[][]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-tools-stub-'))
  const log = path.join(dir, 'calls.tsv')
  const bin = path.join(dir, 'ci-tools')

  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash\nprintf '%s\\t' "$@" >> '${log}'\nprintf '\\n' >> '${log}'\nexit ${exitCode}\n`,
    {
      mode: 0o755,
    },
  )

  if (originalPath !== undefined) throw new Error('stubCiTools called twice; the first stub would leak onto PATH.')
  originalPath = process.env.PATH ?? ''
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`

  return () =>
    fs.existsSync(log) === true
      ? fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => line.split('\t').filter((arg) => arg.length > 0))
      : []
}

const restorePath = (): void => {
  if (originalPath !== undefined) process.env.PATH = originalPath
  originalPath = undefined
}
