import type { Effect } from '@livestore/utils/effect'
import { Schema, WebChannel } from '@livestore/utils/effect'

export class ShutdownBroadcast extends Schema.TaggedStruct('ShutdownBroadcast', {
  reason: Schema.Literal('devtools', 'error'),
}) {}

export class DedicatedWorkerDisconnectBroadcast extends Schema.TaggedStruct('DedicatedWorkerDisconnectBroadcast', {}) {}

export class All extends Schema.Union(ShutdownBroadcast, DedicatedWorkerDisconnectBroadcast) {}

export const makeShutdownChannel = (key: string) =>
  WebChannel.broadcastChannel({
    channelName: `livestore.shutdown.${key}`,
    listenSchema: All,
    sendSchema: All,
  })

export type ShutdownChannel = Effect.Effect.Success<ReturnType<typeof makeShutdownChannel>>
