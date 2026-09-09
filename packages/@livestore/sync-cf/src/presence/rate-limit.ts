import { Effect, Schema } from '@livestore/utils/effect'

export interface PresenceRateLimitOptions {
  /**
   * Minimum milliseconds between accepted `PresenceUpdate`s from one client.
   * Join/leave are not limited.
   */
  readonly minIntervalMs: number
  /**
   * `ignore` drops the update and keeps the socket (shadow-ban).
   * `close` closes the socket after the rejected update.
   *
   * @default 'ignore'
   */
  readonly onExceed?: 'ignore' | 'close'
}

export class PresenceRateLimited extends Schema.TaggedError<PresenceRateLimited>(
  '@livestore/presence/PresenceRateLimited',
)('PresenceRateLimited', {
  clientId: Schema.String,
  minIntervalMs: Schema.Finite,
}) {}

export interface PresenceRateLimiter {
  readonly onExceed: 'ignore' | 'close'
  readonly check: (clientId: string) => Effect.Effect<void, PresenceRateLimited>
  readonly forget: (clientId: string) => void
}

export const makePresenceRateLimiter = (
  options: PresenceRateLimitOptions | undefined,
): PresenceRateLimiter => {
  const minIntervalMs = options?.minIntervalMs
  const onExceed = options?.onExceed ?? 'ignore'
  const lastAt = new Map<string, number>()

  return {
    onExceed,
    check: (clientId) => {
      if (minIntervalMs === undefined) return Effect.void
      return Effect.suspend(() => {
        const now = Date.now()
        const last = lastAt.get(clientId) ?? 0
        if (now - last < minIntervalMs) {
          return Effect.fail(new PresenceRateLimited({ clientId, minIntervalMs }))
        }
        lastAt.set(clientId, now)
        return Effect.void
      })
    },
    forget: (clientId) => {
      lastAt.delete(clientId)
    },
  }
}
