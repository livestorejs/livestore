import { RpcTarget } from 'cloudflare:workers'

import type { CfTypes, SyncUpdateAck } from '@livestore/common-cf'
import { makeSyncUpdateDeliver } from '@livestore/sync-cf/client'

// `restore` (the `[restore]` method key for persistent stubs) ships in workerd since 2026-05 but is only typed in the
// `experimental` entry of `@cloudflare/workers-types`. Drop this augmentation once the stable types carry it.
declare module 'cloudflare:workers' {
  export const restore: unique symbol
}

/**
 * Return this from your client Durable Object's `[restore]` (symbol from `cloudflare:workers`). For every live
 * pull the sync backend stores a persistent stub to this target and re-derives it through `[restore]` on each
 * publish, so a hibernated client DO is woken only when there is something to deliver. `onUpdate` runs before
 * the update is routed and is where a rebuilt DO reloads its store.
 *
 * ```ts
 * import { DurableObject, restore } from 'cloudflare:workers'
 * import { restoreStoreDoSyncTarget } from '@livestore/adapter-cloudflare'
 *
 * export class MyDurableObject extends DurableObject {
 *   [restore](params: unknown) {
 *     return restoreStoreDoSyncTarget(this.ctx, params, { onUpdate: (storeId) => this.getStore(storeId) })
 *   }
 * }
 * ```
 */
export const restoreStoreDoSyncTarget = (
  ctx: CfTypes.DurableObjectState,
  params: unknown,
  options?: { onUpdate?: (storeId: string) => Promise<unknown> },
): StoreDoSyncTarget => new StoreDoSyncTarget(makeSyncUpdateDeliver(ctx, params, options))

export class StoreDoSyncTarget extends RpcTarget {
  constructor(private readonly deliverFn: (payload: Uint8Array<ArrayBuffer>) => Promise<SyncUpdateAck>) {
    super()
  }

  deliver(payload: Uint8Array<ArrayBuffer>): Promise<SyncUpdateAck> {
    return this.deliverFn(payload)
  }
}
