import { Effect, KeyValueStore, Option } from '@livestore/utils/effect'
import { UnexpectedError } from '../errors.ts'

export const makeBackendIdHelper = Effect.gen(function* () {
  const kv = yield* KeyValueStore.KeyValueStore

  const backendIdKey = `backendId`
  const backendIdRef = { current: yield* kv.get(backendIdKey).pipe(UnexpectedError.mapToUnexpectedError) }

  const setBackendId = (backendId: string) =>
    Effect.gen(function* () {
      if (backendIdRef.current._tag === 'None' || backendIdRef.current.value !== backendId) {
        backendIdRef.current = Option.some(backendId)
        yield* kv.set(backendIdKey, backendId)
      }
    }).pipe(UnexpectedError.mapToUnexpectedError)

  return {
    lazySet: setBackendId,
    get: () => backendIdRef.current,
  }
})
