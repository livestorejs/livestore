// import { IntentionalShutdownCause } from '@livestore/common'
import { All } from '@livestore/common/leader-thread'

import { makeBroadcastChannel } from './webchannel.js'

// export class DedicatedWorkerDisconnectBroadcast extends Schema.TaggedStruct('DedicatedWorkerDisconnectBroadcast', {}) {}

// export class All extends Schema.Union(IntentionalShutdownCause, DedicatedWorkerDisconnectBroadcast) {}

export const makeShutdownChannel = (storeId: string) =>
  makeBroadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: All,
  })

// export type ShutdownChannel = WebChannel.WebChannel<All, All>
