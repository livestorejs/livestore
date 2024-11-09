import { Effect } from '@livestore/utils/effect'

import type { EventId } from '../adapter-types.js'

export const makeNextMutationEventIdPair =
  (currentMutationEventIdRef: { current: EventId }) => (opts: { localOnly: boolean }) =>
    Effect.gen(function* () {
      // NOTE we always point to `local: 0` for non-localOnly mutations
      const parentId = opts.localOnly
        ? currentMutationEventIdRef.current
        : { global: currentMutationEventIdRef.current.global, local: 0 }

      const id = opts.localOnly
        ? { global: parentId.global, local: parentId.local + 1 }
        : { global: parentId.global + 1, local: 0 }

      currentMutationEventIdRef.current = id

      return { id, parentId }
    })
