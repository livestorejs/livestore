import { Schema, WebChannel } from '@livestore/utils/effect'

export class DedicatedWorkerDisconnectBroadcast extends Schema.TaggedStruct('DedicatedWorkerDisconnectBroadcast', {}) {}

/** Used across workers for leader election purposes */
export const makeWorkerDisconnectChannel = (storeId: string) =>
  WebChannel.broadcastChannel({
    channelName: `livestore.worker-disconnect.${storeId}`,
    schema: DedicatedWorkerDisconnectBroadcast,
  })
