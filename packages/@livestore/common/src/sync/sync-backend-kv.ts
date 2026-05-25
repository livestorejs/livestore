import { Effect, KeyValueStore } from '@livestore/utils/effect'

import { UnknownError } from '../errors.ts'

export const makeBackendIdHelper = Effect.gen(function* () {
  const kv = yield* KeyValueStore.KeyValueStore

  const backendIdKey = `backendId`
  const backendIdRef = { current: (yield* kv.get(backendIdKey).pipe(UnknownError.mapToUnknownError)) ?? undefined }

  const setBackendId = (backendId: string) =>
    Effect.gen(function* () {
      if (backendIdRef.current !== backendId) {
        backendIdRef.current = backendId
        yield* kv.set(backendIdKey, backendId)
      }
    }).pipe(UnknownError.mapToUnknownError)

  return {
    lazySet: setBackendId,
    get: () => backendIdRef.current,
  }
})
