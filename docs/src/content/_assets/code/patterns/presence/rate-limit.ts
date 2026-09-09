import { makeDurableObject } from '@livestore/sync-cf/cf-worker'

import { presenceSchemas } from './schemas.ts'

export class SyncBackendDO extends makeDurableObject({
  presence: {
    schemas: presenceSchemas,
    rateLimit: {
      minIntervalMs: 40,
      onExceed: 'ignore',
    },
  },
}) {}
