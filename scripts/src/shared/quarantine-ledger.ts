/**
 * Every currently-tolerated test failure in this repository.
 *
 * Empty is the intended steady state: it means no required check is lying. Entries are
 * expected to be rare and short-lived — `ci-tools quarantine validate` fails once an entry's
 * `expires` date passes, so a forgotten quarantine reds a required check instead of silently
 * becoming permanent.
 *
 * This module is the source of truth. It stays free of imports so it can be read by a Genie
 * generator source (which must stay out of the runtime dependency closure) and by
 * `test-policy.ts`, which needs the literal type: `QuarantineKey` is
 * uninhabited while the ledger is empty, so `TestPolicy.quarantined(...)` cannot be written
 * without a checked-in entry. `scripts/src/generated/quarantine-ledger.json` is generated from
 * here for the CLI, which cannot read TypeScript.
 */

/** A tolerated test failure, and the record that justifies tolerating it. */
export type QuarantineEntry = {
  /** What is quarantined — a package path, provider key, or suite name. */
  readonly target: string
  /** Why its failures are currently tolerated. */
  readonly reason: string
  /** Issue tracking the underlying problem. */
  readonly issue: string
  /** `YYYY-MM-DD`. Past this date the ledger check fails, forcing a renew-or-remove decision. */
  readonly expires: string
}

export const quarantineLedger = {
  'devtools-suite': {
    target: 'tests/integration:devtools',
    reason:
      'Every test in the suite fails (0/15). All browser-extension tests die at "No devtools page found"; the rest time out on locators. Pre-existing — the suite was silently suppressed from 2025-05-10 until #1404.',
    issue: 'https://github.com/livestorejs/livestore/issues/1489',
    expires: '2026-09-30',
  },
} as const satisfies Record<string, QuarantineEntry>

export type QuarantineKey = keyof typeof quarantineLedger
