import { Effect } from '@livestore/utils/effect'

import type { EventId } from '../adapter-types.js'

// TODO replace this with a proper rebase sync strategy
export const validateAndUpdateMutationEventId = ({
  currentMutationEventIdRef,
  mutationEventId,
  debugContext,
}: {
  currentMutationEventIdRef: { current: EventId }
  mutationEventId: EventId
  debugContext?: any
}) =>
  Effect.gen(function* () {
    // TODO also validate local id + parent ids
    if (
      mutationEventId.global > currentMutationEventIdRef.current.global ||
      (mutationEventId.global === currentMutationEventIdRef.current.global &&
        mutationEventId.local > currentMutationEventIdRef.current.local)
    ) {
      currentMutationEventIdRef.current = { ...mutationEventId }
    } else if (mutationEventId.global < currentMutationEventIdRef.current.global) {
      // if (isDevEnv()) {
      //   debugger
      // }
      console.warn(
        `LiveStore doesn't support concurrent writes yet. Mutation event id is behind current mutation event id`,
        { mutationEventId, currentMutationEventId: currentMutationEventIdRef.current, debugContext },
      )
      // yield* UnexpectedError.make({
      //   cause: `LiveStore doesn't support concurrent writes yet. Mutation event id is behind current mutation event id`,
      //   payload: {
      //     mutationEventId,
      //     currentMutationEventId: currentMutationEventIdRef.current,
      //     debugContext,
      //   },
      // })
    }
  })
