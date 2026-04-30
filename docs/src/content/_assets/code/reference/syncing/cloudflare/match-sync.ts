import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import { matchSyncRequest } from '@livestore/sync-cf/cf-worker'

declare const request: CfTypes.Request

const searchParams = matchSyncRequest(request)
if (searchParams !== undefined) {
  const { storeId, payload, transport } = searchParams
  console.log(`Sync request for store ${storeId} via ${transport}`)
  console.log(payload)
}
