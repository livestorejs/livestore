import { Effect } from '@livestore/utils/effect'

import type { EventId } from '../adapter-types.js'

// TODO replace this with a proper rebase sync strategy
export const validateAndUpdateLocalHead = ({
  localHeadRef,
  mutationEventId,
  debugContext,
}: {
  localHeadRef: { current: EventId }
  mutationEventId: EventId
  debugContext?: any
}) =>
  Effect.gen(function* () {
    // TODO also validate local id + parent ids
    if (
      mutationEventId.global > localHeadRef.current.global ||
      (mutationEventId.global === localHeadRef.current.global && mutationEventId.local > localHeadRef.current.local)
    ) {
      localHeadRef.current = { ...mutationEventId }
    } else if (mutationEventId.global < localHeadRef.current.global) {
      // if (isDevEnv()) {
      //   debugger
      // }
      yield* Effect.logWarning(
        `LiveStore doesn't support concurrent writes yet. Mutation event id is behind current mutation event id`,
        { mutationEventId, currentMutationEventId: localHeadRef.current, debugContext },
      )
      // yield* UnexpectedError.make({
      //   cause: `LiveStore doesn't support concurrent writes yet. Mutation event id is behind current mutation event id`,
      //   payload: {
      //     mutationEventId,
      //     currentMutationEventId: localHeadRef.current,
      //     debugContext,
      //   },
      // })
    }
  })
