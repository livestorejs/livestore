import type { Effect, Stream } from '@livestore/utils/effect'

import type { MigrationsReport } from './defs.ts'
import type * as Devtools from './devtools/mod.ts'
import type { UnexpectedError } from './errors.ts'
import type * as EventSequenceNumber from './schema/EventSequenceNumber.ts'
import type { LiveStoreEvent } from './schema/mod.ts'
import type { LeaderAheadError } from './sync/sync.ts'
import type { PayloadUpstream, SyncState } from './sync/syncstate.ts'

export interface ClientSessionLeaderThreadProxy {
  events: {
    pull: (args: {
      cursor: EventSequenceNumber.EventSequenceNumber
    }) => Stream.Stream<{ payload: typeof PayloadUpstream.Type }, UnexpectedError>
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
