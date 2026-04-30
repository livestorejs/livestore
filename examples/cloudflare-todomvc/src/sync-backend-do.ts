import * as SyncBackend from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  // onPush: async (message, { storeId }) => {
  //   console.log(`onPush for store (${storeId})`, message.batch)
  // },
}) {}
