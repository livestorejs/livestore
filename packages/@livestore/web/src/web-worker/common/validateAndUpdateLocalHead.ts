import type { EventId } from '@livestore/common'
// import { UnexpectedError } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'

// TODO replace this with a proper rebase sync strategy
export const validateAndUpdateLocalHead = ({
  currentMutationEventIdRef,
  mutationEventId,
  debugContext,
}: {
  currentMutationEventIdRef: { current: EventId }
  mutationEventId: EventId
  debugContext?: any
}) =>
  Effect.gen(function* () {
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
      yield* Effect.logWarning(
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
