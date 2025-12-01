import { type Effect, Schema, type Scope, type WebChannel } from '@livestore/utils/effect'
import { WebChannelBrowser } from '@livestore/utils/effect/browser'

export class DedicatedWorkerDisconnectBroadcast extends Schema.TaggedStruct('DedicatedWorkerDisconnectBroadcast', {}) {}

/** Used across workers for leader election purposes */
export const makeWorkerDisconnectChannel = (
  storeId: string,
): Effect.Effect<
  WebChannel.WebChannel<typeof DedicatedWorkerDisconnectBroadcast.Type, typeof DedicatedWorkerDisconnectBroadcast.Type>,
  never,
  Scope.Scope
> =>
  WebChannelBrowser.broadcastChannel({
    channelName: `livestore.worker-disconnect.${storeId}`,
    schema: DedicatedWorkerDisconnectBroadcast,
  })
