import type { ShutdownChannel } from '@livestore/common/leader-thread'
import { WebChannel } from '@livestore/utils/effect'

// TODO find an actual implementation for Expo
export const makeShutdownChannel = (storeId: string) =>
  WebChannel.noopChannel<typeof ShutdownChannel.All.Type, typeof ShutdownChannel.All.Type>()
// WebChannel.broadcastChannel({
//   channelName: `livestore.shutdown.${storeId}`,
//   schema: ShutdownChannel.All,
// })
