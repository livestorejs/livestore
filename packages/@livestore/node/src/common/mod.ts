import { BCMessage } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'

import { makeBroadcastChannel } from '../webchannel.js'

export const makeSyncBroadcastChannel = (schema: LiveStoreSchema, storeId: string) =>
  makeBroadcastChannel({
    channelName: `livestore-sync-${schema.hash}-${storeId}`,
    schema: BCMessage.Message,
  })
