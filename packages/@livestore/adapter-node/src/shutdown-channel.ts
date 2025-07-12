import { ShutdownChannel } from '@livestore/common/leader-thread'

import { makeBroadcastChannel } from './webchannel.ts'

export const makeShutdownChannel = (storeId: string) =>
  makeBroadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: ShutdownChannel.All,
  })
