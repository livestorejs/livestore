import type { Effect, Option } from '@livestore/utils/effect'

import type { MaterializeError, UnknownError } from '../errors.ts'
import type { EventSequenceNumber, LiveStoreEvent, StateBackendId } from '../schema/mod.ts'

export type LeaderStateBackend = {
  materializeEvent: (
    event: LiveStoreEvent.Client.EncodedWithMeta,
    options?: { skipEventlog?: boolean },
  ) => Effect.Effect<
    {
      sessionChangeset: { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any } | { _tag: 'no-op' }
      hash: Option.Option<number>
    },
    MaterializeError
  >

  rollback: (args: {
    eventNumsToRollback: ReadonlyArray<EventSequenceNumber.Client.Composite>
  }) => Effect.Effect<void, UnknownError>
}

export type SessionStateBackend = {
  materializeEvent: (
    event: LiveStoreEvent.Client.EncodedWithMeta,
    opts: { withChangeset: boolean; materializerHashLeader: Option.Option<number> },
  ) => Effect.Effect<
    {
      writeTables: Set<string>
      sessionChangeset:
        | { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any }
        | { _tag: 'no-op' }
        | { _tag: 'unset' }
      materializerHash: Option.Option<number>
    },
    MaterializeError
  >

  rollback: (changeset: Uint8Array<ArrayBuffer>, backendId?: StateBackendId) => void
}
