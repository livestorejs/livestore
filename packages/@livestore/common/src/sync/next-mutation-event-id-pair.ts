import type { EventId } from '../adapter-types.js'

export const makeNextMutationEventIdPair = (localHeadRef: { current: EventId }) => (opts: { localOnly: boolean }) => {
  // NOTE we always point to `local: 0` for non-localOnly mutations
  const parentId = opts.localOnly ? localHeadRef.current : { global: localHeadRef.current.global, local: 0 }

  const id = opts.localOnly
    ? { global: parentId.global, local: parentId.local + 1 }
    : { global: parentId.global + 1, local: 0 }

  localHeadRef.current = id

  return { id, parentId }
}
