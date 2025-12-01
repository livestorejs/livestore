import { ShutdownChannel } from '@livestore/common/leader-thread'
import { WebChannel } from '@livestore/utils/effect'

// Once we'll implement multi-threading for the Expo adapter, we'll need to implement a multi-threaded version of this
export const makeShutdownChannel = (storeId: string) =>
  WebChannel.sameThreadChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: ShutdownChannel.All,
  })
