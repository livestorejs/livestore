import { IntentionalShutdownCause } from '@livestore/common'
import type { Effect } from '@livestore/utils/effect'
import { Schema, WebChannel } from '@livestore/utils/effect'

export class DedicatedWorkerDisconnectBroadcast extends Schema.TaggedStruct('DedicatedWorkerDisconnectBroadcast', {}) {}

export class All extends Schema.Union(IntentionalShutdownCause, DedicatedWorkerDisconnectBroadcast) {}

export const makeShutdownChannel = (storeId: string) =>
  WebChannel.broadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    listenSchema: All,
    sendSchema: All,
  })

export type ShutdownChannel = Effect.Effect.Success<ReturnType<typeof makeShutdownChannel>>
