import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { Effect } from '@livestore/utils/effect'

import type { QuarantineKey } from './quarantine-ledger.ts'

/**
 * How a test target's failures reach the job's exit code.
 *
 * Test targets invoked through {@link runTestTarget} state their policy explicitly, so
 * weakening one is a deliberate, reviewable act rather than a `.pipe(Effect.ignore)` or a
 * `|| true` buried in a task wrapper. Quarantining is reachable only through
 * {@link quarantined}, which accepts a key of `quarantineLedger` — so a quarantine here cannot
 * exist without a checked-in entry carrying a reason, tracking issue, and expiry date. The
 * ledger lives in `scripts/src/shared/quarantine-ledger.ts`; `ci-tools quarantine` owns what an entry means.
 *
 * What this is NOT: a chokepoint. It governs whole invocations, not individual tests, and it
 * is opt-in — `it.skip`, `test.todo`, an `exclude` glob, piping `Effect.ignore` onto the
 * result, or bypassing the helper entirely all still tolerate a failure without a ledger
 * entry, and none of them are type errors. Treat this as the honest path for suppressing a
 * target, not a guarantee that no other path exists.
 */
export type TestPolicy = { readonly _tag: 'blocking' } | { readonly _tag: 'quarantined'; readonly key: QuarantineKey }

/** Failures fail the job. The default for every target. */
export const blocking: TestPolicy = { _tag: 'blocking' }

/** Failures are reported but do not fail the job, under a declared, expiring ledger entry. */
export const quarantined = (key: QuarantineKey): TestPolicy => ({ _tag: 'quarantined', key })

export { type QuarantineEntry, type QuarantineKey, quarantineLedger } from './quarantine-ledger.ts'

/** Generated from {@link quarantineLedger}; the CLI reads JSON, not TypeScript. */
export const quarantineLedgerJsonPath = fileURLToPath(new URL('../generated/quarantine-ledger.json', import.meta.url))

/**
 * Runs a test target under its stated policy.
 *
 * A quarantined failure is announced by `ci-tools quarantine announce`, which owns what a
 * quarantine means: it resolves the key against the ledger, refuses an entry applied to a
 * target it does not declare, writes the job-summary line, and emits the `::warning::`
 * annotation. A failure to announce is fatal rather than ignored — tolerating a
 * failure *and* losing its signal is the exact outcome this mechanism exists to prevent.
 *
 * Contract: effect-utils `context/ci-tools/01-quarantine/`.
 */
export const runTestTarget = <A, E, R>({
  label,
  policy,
  run,
}: {
  readonly label: string
  readonly policy: TestPolicy
  readonly run: Effect.Effect<A, E, R>
}): Effect.Effect<void, E, R> => {
  if (policy._tag === 'blocking') return run.pipe(Effect.asVoid)

  return run.pipe(
    Effect.asVoid,
    Effect.tapError(() => Effect.sync(() => announceQuarantinedFailure(label, policy.key))),
    Effect.ignore,
  )
}

const announceQuarantinedFailure = (label: string, key: QuarantineKey): void => {
  const result = spawnSync(
    'ci-tools',
    ['quarantine', 'announce', '--ledger', quarantineLedgerJsonPath, '--key', key, '--label', label],
    { stdio: 'inherit' },
  )

  if (result.error !== undefined) {
    throw new Error(`Could not announce quarantined failure for ${label}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(`Announcing the quarantined failure for ${label} failed with exit code ${result.status}.`)
  }
}
