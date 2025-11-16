import { makeMockSyncBackend } from '@livestore/common'
import { SyncBackend } from '@livestore/common/sync'
import { Effect } from '@livestore/utils/effect'

export const makeLoopbackSyncBackend = (): SyncBackend.SyncBackendConstructor =>
  () =>
    Effect.gen(function* () {
      const mock = yield* makeMockSyncBackend({ startConnected: true })
      return yield* mock.makeSyncBackend
    })

