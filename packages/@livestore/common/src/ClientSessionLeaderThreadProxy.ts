import type { Effect, Stream } from '@livestore/utils/effect'

import type { LeaderPullCursor, MigrationsReport } from './defs.js'
import type * as Devtools from './devtools/mod.js'
import type { UnexpectedError } from './errors.js'
import type * as EventSequenceNumber from './schema/EventSequenceNumber.js'
import type { LiveStoreEvent } from './schema/mod.js'
import type { LeaderAheadError } from './sync/sync.js'
import type { PayloadUpstream, SyncState } from './sync/syncstate.js'

export interface ClientSessionLeaderThreadProxy {
  events: {
    pull: (args: {
      cursor: LeaderPullCursor
    }) => Stream.Stream<{ payload: typeof PayloadUpstream.Type; mergeCounter: number }, UnexpectedError>
    /** It's important that a client session doesn't call `push` concurrently. */
    push(batch: ReadonlyArray<LiveStoreEvent.AnyEncoded>): Effect.Effect<void, UnexpectedError | LeaderAheadError>
  }
  /** The initial state after the leader thread has booted */
  readonly initialState: {
    /** The latest event sequence number during boot. Used for the client session to resume syncing. */
    readonly leaderHead: EventSequenceNumber.EventSequenceNumber
    /** The migrations report from the leader thread */
    readonly migrationsReport: MigrationsReport
  }
  export: Effect.Effect<Uint8Array, UnexpectedError>
  getEventlogData: Effect.Effect<Uint8Array, UnexpectedError>
  getSyncState: Effect.Effect<SyncState, UnexpectedError>
  /** For debugging purposes it can be useful to manually trigger devtools messages (e.g. to reset the database) */
  sendDevtoolsMessage: (message: Devtools.Leader.MessageToApp) => Effect.Effect<void, UnexpectedError>
}

export const of = (
  proxy: ClientSessionLeaderThreadProxy,
  options?: { overrides?: (original: ClientSessionLeaderThreadProxy) => Partial<ClientSessionLeaderThreadProxy> },
): ClientSessionLeaderThreadProxy => {
  if (options?.overrides === undefined) return proxy

  return { ...proxy, ...options.overrides(proxy) }
}
