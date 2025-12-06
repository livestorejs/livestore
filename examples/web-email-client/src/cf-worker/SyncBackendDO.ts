import * as SyncBackend from '@livestore/sync-cf/cf-worker'

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: (message, context) => {
    console.log(
      `[${context.storeId}] sync push - ${message.batch.length} events:`,
      message.batch.map((e) => e.name).join(', '),
    )
  },
}) {}
