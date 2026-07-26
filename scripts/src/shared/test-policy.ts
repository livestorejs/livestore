import fs from 'node:fs'

import { Effect, Schema } from '@livestore/utils/effect'

/**
 * How a test target's failures reach the job's exit code.
 *
 * Every test invocation states its policy explicitly, so weakening a required check is a
 * deliberate, reviewable act rather than a `.pipe(Effect.ignore)` or a `|| true` buried in a
 * task wrapper. Quarantining is reachable only through {@link quarantined}, which accepts a
 * key of {@link quarantineLedger} — so a quarantine cannot exist without a checked-in entry
 * carrying a reason, a tracking issue, and an expiry date.
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
export const quarantineLedger = {} as const satisfies Record<string, QuarantineEntry>

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
  Object.entries(ledger).filter(([, entry]) => entry.expires < today)

const announceQuarantinedFailure = (label: string, entry: QuarantineEntry): void => {
  const summary = `Quarantined failure: ${label} (${entry.target}) — ${entry.reason}. Tracking ${entry.issue}, expires ${entry.expires}.`
  console.log(`::warning title=Quarantined test failure::${summary}`)

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath !== undefined && summaryPath !== '') {
    fs.appendFileSync(summaryPath, `- ${summary}\n`)
  }
}
