import { Vitest } from '@livestore/utils-dev/node-vitest'

import { type RpcSubscription, rpcSubscriptionKeyPrefix } from '../../shared.ts'
import { dropRpcSubscription } from './do-rpc-server.ts'

const durableObjectId = 'client-do'
const key = `${rpcSubscriptionKeyPrefix}${durableObjectId}`

const subscribedWith = (requestId: string) => {
  const rows = new Map<string, RpcSubscription>([
    [
      key,
      { storeId: 'store', subscribedAt: 0, requestId, callerContext: { bindingName: 'CLIENT_DO', durableObjectId } },
    ],
  ])
  return { rows, kv: { get: (k: string) => rows.get(k), delete: (k: string) => rows.delete(k) } }
}

Vitest.describe('sync-cf DO-RPC unsubscribe', () => {
  // A replacement pull overwrote the row with its own request id; the earlier pull's late unsubscribe must be a no-op.
  Vitest.test('keeps the row when the request id was superseded', () => {
    const { rows, kv } = subscribedWith('pull-2')
    dropRpcSubscription(kv, { durableObjectId, requestId: 'pull-1' })
    Vitest.expect(rows.has(key)).toBe(true)
  })

  Vitest.test('drops the row for the pull that registered it', () => {
    const { rows, kv } = subscribedWith('pull-1')
    dropRpcSubscription(kv, { durableObjectId, requestId: 'pull-1' })
    Vitest.expect(rows.has(key)).toBe(false)
  })
})
