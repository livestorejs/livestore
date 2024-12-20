// import { IntentionalShutdownCause } from '@livestore/common'
import { All } from '@livestore/common/leader-thread'
import { Schema, WebChannel } from '@livestore/utils/effect'

// export class DedicatedWorkerDisconnectBroadcast extends Schema.TaggedStruct('DedicatedWorkerDisconnectBroadcast', {}) {}

// export class All extends Schema.Union(IntentionalShutdownCause, DedicatedWorkerDisconnectBroadcast) {}

export const makeShutdownChannel = (storeId: string) =>
  WebChannel.broadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: All,
  })

// export type ShutdownChannel = WebChannel.WebChannel<All, All>
