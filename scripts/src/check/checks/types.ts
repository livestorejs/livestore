import type { Effect } from '@livestore/utils/effect'

import type { CheckType } from '../events.ts'

/**
 * A single check that can be run as part of `mono check`.
 */
export interface Check {
  /** The category of this check (typecheck, lint, test). */
  readonly type: CheckType

  /** Human-readable name for display. */
  readonly name: string

  /** Whether this check is considered "fast" for the default path. */
  readonly fast: boolean

  /**
   * Run this check.
   * The check should publish events to CheckEventPubSub as it progresses.
   * Returns void on success, fails on error.
   *
   * The effect can have any error type (will be caught by the runner)
   * and any context requirements (will be provided by the runner).
   */
  readonly run: Effect.Effect<void, unknown, unknown>
}
