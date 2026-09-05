import { makeDurableObject } from '@livestore/sync-cf/cf-worker'

import { presenceSchemas } from './schemas.ts'

export class SyncBackendDO extends makeDurableObject({
  presence: {
    schemas: presenceSchemas,
    onUpdate: (event) => {
      console.log('presence', event.roomId, event.channel, event.clientId, event.state)
    },
    onLeave: (event) => {
      console.log('left', event.roomId, event.clientId)
    },
  },
}) {}
