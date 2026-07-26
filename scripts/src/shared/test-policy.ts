import fs from 'node:fs'

import { Effect, Schema } from '@livestore/utils/effect'

/**
 * How a test target's failures reach the job's exit code.
 *
 * Test targets invoked through {@link runTestTarget} state their policy explicitly, so
 * weakening one is a deliberate, reviewable act rather than a `.pipe(Effect.ignore)` or a
 * `|| true` buried in a task wrapper. Quarantining is reachable only through
 * {@link quarantined}, which accepts a key of {@link quarantineLedger} — so a quarantine here
 * cannot exist without a checked-in entry carrying a reason, tracking issue, and expiry date.
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

export class QuarantineEntry extends Schema.Class<QuarantineEntry>('QuarantineEntry')({
  /** What is quarantined — a package path, provider key, or suite name. */
  target: Schema.String,
  /** Why its failures are currently tolerated. */
  reason: Schema.String,
  /** Issue tracking the underlying problem. */
  issue: Schema.String,
  /** `YYYY-MM-DD`. Past this date the ledger check fails, forcing a renew-or-remove decision. */
  expires: Schema.String,
}) {}

/**
 * Every currently-tolerated test failure in the repository.
 *
 * Empty is the intended steady state: it means no required check is lying. Entries are
 * expected to be rare and short-lived — `expires` is enforced by
 * `test-policy.test.ts`, so a forgotten quarantine reds `test-unit` instead of
 * silently becoming permanent.
 */
export const quarantineLedger = {
  'devtools-suite': new QuarantineEntry({
    target: 'tests/integration:devtools',
    reason:
      'Every test in the suite fails (0/15). All browser-extension tests die at "No devtools page found"; the rest time out on locators. Pre-existing — the suite was silently suppressed from 2025-05-10 until #1404.',
    issue: 'https://github.com/livestorejs/livestore/issues/1489',
    expires: '2026-09-30',
  }),
} as const satisfies Record<string, QuarantineEntry>

export type QuarantineKey = keyof typeof quarantineLedger

/**
 * Runs a test target under its stated policy.
 *
 * A quarantined failure is announced on its own line and in the job summary, so a suppressed
 * failure is distinguishable from a genuine pass — the property the previous `::warning::`
 * wrappers lacked, being indistinguishable from unrelated Actions warnings.
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

  const entry = (quarantineLedger as Record<string, QuarantineEntry>)[policy.key]

  // The type checker rejects an unknown key, but a cast or a JS caller can still get here, and
  // silently treating an unknown quarantine as "suppress everything" is the failure this whole
  // mechanism exists to prevent.
  if (entry === undefined) {
    throw new Error(`Quarantine '${String(policy.key)}' has no entry in the ledger.`)
  }

  // The ledger's `target` is the declaration of what is suppressed, so it has to be enforced
  // rather than decorative: without this, one entry's key could silently suppress an unrelated
  // target under another target's reason, issue, and expiry.
  if (entry.target !== label) {
    throw new Error(
      `Quarantine '${String(policy.key)}' declares target ${JSON.stringify(entry.target)} but was applied to ${JSON.stringify(label)}.`,
    )
  }

  return run.pipe(
    Effect.asVoid,
    Effect.tapError(() => Effect.sync(() => announceQuarantinedFailure(label, entry))),
    Effect.ignore,
  )
}

/**
 * Entries whose expiry has passed, relative to `today` (`YYYY-MM-DD`).
 *
 * Takes the ledger as an argument so the expiry rule stays testable while the real ledger is
 * empty — otherwise the check that keeps quarantines from becoming permanent would itself be
 * unverified.
 */
export const expiredEntries = (
  ledger: Record<string, QuarantineEntry>,
  today: string,
): readonly (readonly [string, QuarantineEntry])[] =>
  Object.entries(ledger).filter(([, entry]) => isExpired(entry.expires, today))

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

/**
 * A malformed `expires` counts as expired.
 *
 * Comparison is lexicographic, so any free-form string (`'someday'`) sorts above every real
 * date and would otherwise never expire — turning a typo into a permanent quarantine, which
 * is the outcome the expiry rule exists to prevent.
 */
const isExpired = (expires: string, today: string): boolean => isoDatePattern.test(expires) === false || expires < today

const announceQuarantinedFailure = (label: string, entry: QuarantineEntry): void => {
  const summary = `Quarantined failure: ${label} — ${entry.reason} Tracking ${entry.issue}, expires ${entry.expires}.`

  // The job summary is the load-bearing channel. The annotation below is best-effort: a
  // tolerated failure exits 0, and `devenv tasks run` prints a task's stdout only when the
  // task fails, so this line is discarded whenever the run happens under devenv — the same
  // trap that made the old `|| echo "::warning::"` wrappers invisible for over a year.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath !== undefined && summaryPath !== '') {
    fs.appendFileSync(summaryPath, `- ${summary}\n`)
  }

  console.log(`::warning title=Quarantined test failure::${summary}`)
}
