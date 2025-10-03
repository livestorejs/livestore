import { Effect } from '@livestore/utils/effect'

import { UnknownEventError } from '../errors.ts'
import type { EventDef, Materializer } from './EventDef.ts'
import type * as LiveStoreEvent from './LiveStoreEvent.ts'
import type { LiveStoreSchema } from './schema.ts'

export type UnknownEventContext = {
  readonly event: Pick<LiveStoreEvent.AnyEncoded, 'name' | 'args' | 'seqNum' | 'clientId' | 'sessionId'>
  readonly reason: 'event-definition-missing' | 'materializer-missing'
  readonly operation: string
}

export namespace UnknownEvents {
  export type HandlingStrategy = 'warn' | 'fail' | 'ignore' | 'callback'

  export type Callback = (context: UnknownEventContext, error: UnknownEventError) => void | Promise<void>

  export type HandlingConfig =
    | { readonly strategy: 'warn' }
    | { readonly strategy: 'ignore' }
    | { readonly strategy: 'fail' }
    | { readonly strategy: 'callback'; readonly onUnknownEvent: Callback }

  export type Reason = UnknownEventContext['reason']

  export type ResolveContext = Omit<UnknownEventContext, 'reason'>

  export type Resolved =
    | {
        readonly _tag: 'known'
        readonly eventDef: EventDef.AnyWithoutFn
        readonly materializer: Materializer
      }
    | {
        readonly _tag: 'unknown'
        readonly reason: Reason
      }
}

const DEFAULT_UNKNOWN_EVENT_HANDLING: UnknownEvents.HandlingConfig = { strategy: 'warn' }

export const normalizeUnknownEventHandling = (
  input: UnknownEvents.HandlingConfig | undefined,
): UnknownEvents.HandlingConfig => input ?? DEFAULT_UNKNOWN_EVENT_HANDLING

const handleUnknownEvent = ({
  schema,
  context,
}: {
  schema: LiveStoreSchema
  context: UnknownEventContext
}): Effect.Effect<void, UnknownEventError> =>
  Effect.gen(function* () {
    const config = schema.unknownEventHandling
    const error = new UnknownEventError(context)

    switch (config.strategy) {
      case 'fail': {
        return yield* Effect.fail(error)
      }
      case 'warn': {
        yield* Effect.logWarning('@livestore/common:schema:unknown-event', context)
        return
      }
      case 'ignore': {
        return
      }
      case 'callback': {
        const callback = config.onUnknownEvent

        yield* Effect.try(() => callback(context, error)).pipe(
          Effect.catchAll((cause) =>
            Effect.logWarning('@livestore/common:schema:unknown-event:callback-error', {
              event: context.event,
              reason: context.reason,
              operation: context.operation,
              cause,
            }),
          ),
        )
        return
      }
    }
  })

/**
 * Resolves the runtime event definition + materializer for a given event name.
 *
 * Behaviour is intentionally split across the result and error channels:
 * - For `'fail'` handling, we surface an `UnknownEventError` via the failure channel so
 *   callers can convert it into the appropriate domain error (for example `MaterializeError`).
 * - For all other strategies (`warn`, `ignore`, `callback`) we succeed with an
 *   `{ _tag: 'unknown' }` value, signalling that the caller should skip the event while
 *   continuing normal processing.
 */
export const resolveEventDef = (
  schema: LiveStoreSchema,
  context: UnknownEvents.ResolveContext,
): Effect.Effect<UnknownEvents.Resolved, UnknownEventError> =>
  Effect.gen(function* () {
    const eventName = context.event.name
    const eventDef = schema.eventsDefsMap.get(eventName)
    if (eventDef === undefined) {
      yield* handleUnknownEvent({
        schema,
        context: {
          event: context.event,
          reason: 'event-definition-missing',
          operation: context.operation,
        },
      })
      return { _tag: 'unknown', reason: 'event-definition-missing' }
    }
    const materializer = schema.state.materializers.get(eventName)
    if (materializer === undefined) {
      yield* handleUnknownEvent({
        schema,
        context: {
          event: context.event,
          reason: 'materializer-missing',
          operation: context.operation,
        },
      })
      return { _tag: 'unknown', reason: 'materializer-missing' }
    }
    return { _tag: 'known', eventDef, materializer }
  })
