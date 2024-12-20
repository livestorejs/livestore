import { BCMessage } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { WebChannel } from '@livestore/utils/effect'

export const makeSyncBroadcastChannel = (schema: LiveStoreSchema, storeId: string) =>
  WebChannel.broadcastChannel({
    channelName: `livestore-sync-${schema.hash}-${storeId}`,
    schema: BCMessage.Message,
  })
