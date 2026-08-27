import { UnknownError } from '@livestore/common'
import { omitUndefineds } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

import { type PresenceRateLimitOptions, makePresenceRateLimiter, PresenceRateLimited } from './rate-limit.ts'
import {
  type PresenceChannelDef,
  PresenceChannelError,
  type PresenceHub,
  type PresenceRoomOptions,
  makePresenceHub,
} from './room.ts'

export type PresenceHookEvent = {
  readonly storeId: string
  readonly roomId: string
  readonly channel: string
  readonly clientId: string
  readonly name?: string
  readonly state?: unknown
}

export type PresenceHookContext = {
  readonly payload?: unknown
  readonly headers?: ReadonlyMap<string, string>
}

/**
 * Same shape as `onPush` / `onPull`: sync, Promise, or Effect.
 * Throw / fail to reject the mutation (authz, policy).
 */
export type PresenceHook = (
  event: PresenceHookEvent,
  context: PresenceHookContext,
) => Effect.SyncOrPromiseOrEffect<void>

export type PresenceServerOptions = PresenceRoomOptions & {
  readonly channels: Record<string, PresenceChannelDef>
  readonly onJoin?: PresenceHook
  readonly onUpdate?: PresenceHook
  readonly onLeave?: PresenceHook
  readonly rateLimit?: PresenceRateLimitOptions
}

export type PresenceMutation = {
  readonly storeId: string
  readonly roomId: string
  readonly channel: string
  readonly clientId: string
  readonly name?: string
  readonly state?: unknown
}

export interface PresenceServer {
  readonly hub: PresenceHub
  readonly rateLimitOnExceed: 'ignore' | 'close'
  join: (input: PresenceMutation, context: PresenceHookContext) => Effect.Effect<void, PresenceChannelError | UnknownError>
  update: (
    input: PresenceMutation,
    context: PresenceHookContext,
  ) => Effect.Effect<void, PresenceChannelError | PresenceRateLimited | UnknownError>
  leave: (input: PresenceMutation, context: PresenceHookContext) => Effect.Effect<void, UnknownError>
  leaveClient: (clientId: string) => Effect.Effect<void>
}

const runHook = (
  hook: PresenceHook | undefined,
  event: PresenceHookEvent,
  context: PresenceHookContext,
): Effect.Effect<void, UnknownError> => {
  if (hook === undefined) return Effect.void
  return Effect.trySyncOrPromiseOrEffect(() => hook(event, context)).pipe(UnknownError.mapToUnknownError)
}

export const makePresenceServer = (
  storeId: string,
  options: PresenceServerOptions,
): Effect.Effect<PresenceServer> =>
  Effect.gen(function* () {
    const hub = yield* makePresenceHub(
      storeId,
      omitUndefineds({
        channels: options.channels,
        memberIdleTtlMs: options.memberIdleTtlMs,
        sweepIntervalMs: options.sweepIntervalMs,
      }),
    )
    const limiter = makePresenceRateLimiter(options.rateLimit)

    const eventOf = (input: PresenceMutation): PresenceHookEvent => ({
      storeId: input.storeId,
      roomId: input.roomId,
      channel: input.channel,
      clientId: input.clientId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
    })

    return {
      hub,
      rateLimitOnExceed: limiter.onExceed,

      join: (input, context) =>
        Effect.gen(function* () {
          yield* runHook(options.onJoin, eventOf(input), context)
          yield* hub.join(input.roomId, input.channel, input.clientId, input.name)
        }),

      update: (input, context) =>
        Effect.gen(function* () {
          yield* limiter.check(input.clientId)
          yield* runHook(options.onUpdate, eventOf(input), context)
          yield* hub.update(input.roomId, input.channel, input.clientId, input.state)
        }),

      leave: (input, context) =>
        Effect.gen(function* () {
          yield* runHook(options.onLeave, eventOf(input), context)
          yield* hub.leave(input.roomId, input.channel, input.clientId)
          limiter.forget(input.clientId)
        }),

      leaveClient: (clientId) =>
        Effect.gen(function* () {
          yield* hub.leaveClient(clientId)
          limiter.forget(clientId)
        }),
    }
  })
