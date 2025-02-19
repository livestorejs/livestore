import { ShutdownChannel } from '@livestore/common/leader-thread'
import { WebChannel } from '@livestore/utils/effect'

export const makeShutdownChannel = (storeId: string) =>
  WebChannel.broadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: ShutdownChannel.All,
  })
