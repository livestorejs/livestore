import { makeDurableObject } from '@livestore/sync-cf/cf-worker'

import { presenceSchemas } from './schemas.ts'

export class SyncBackendDO extends makeDurableObject({
  presence: {
    schemas: presenceSchemas,
    room: { memberIdleTtlMs: 15_000 },
  },
}) {}
