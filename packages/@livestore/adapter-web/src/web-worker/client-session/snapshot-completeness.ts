import { UnknownError } from '@livestore/common'
import type { LiveStoreSchema, StateBackendId } from '@livestore/common/schema'
import { Effect } from '@livestore/utils/effect'

export type SnapshotSourceTag = 'fast-path' | 'from-leader-worker'

export const getExpectedBackendIds = (schema: LiveStoreSchema): ReadonlyArray<StateBackendId> =>
  Array.from(schema.state.backends.keys())

export const getMissingBackendSnapshots = ({
  schema,
  snapshotsByBackend,
}: {
  schema: LiveStoreSchema
  snapshotsByBackend: ReadonlyMap<StateBackendId, Uint8Array<ArrayBufferLike>>
}): ReadonlyArray<StateBackendId> =>
  getExpectedBackendIds(schema).filter((backendId) => snapshotsByBackend.has(backendId) === false)

export const isSnapshotSetComplete = ({
  schema,
  snapshotsByBackend,
}: {
  schema: LiveStoreSchema
  snapshotsByBackend: ReadonlyMap<StateBackendId, Uint8Array<ArrayBufferLike>>
}): boolean => getMissingBackendSnapshots({ schema, snapshotsByBackend }).length === 0

export const ensureSnapshotsByBackendComplete = ({
  schema,
  snapshotsByBackend,
  sourceTag,
}: {
  schema: LiveStoreSchema
  snapshotsByBackend: ReadonlyMap<StateBackendId, Uint8Array<ArrayBufferLike>>
  sourceTag: SnapshotSourceTag
}) =>
  Effect.gen(function* () {
    const missingBackendIds = getMissingBackendSnapshots({ schema, snapshotsByBackend })

    if (missingBackendIds.length > 0) {
      return yield* UnknownError.make({
        cause: `Missing backend snapshots during session boot.`,
        note: `Snapshot source "${sourceTag}" must include all schema backends.`,
        payload: {
          sourceTag,
          missingBackendIds,
          expectedBackendIds: getExpectedBackendIds(schema),
          availableBackendIds: Array.from(snapshotsByBackend.keys()),
        },
      })
    }

    return snapshotsByBackend
  })
