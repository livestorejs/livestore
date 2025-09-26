import { makeDurableObject } from '@livestore/sync-cf/cf-worker'

type Transport = 'http' | 'ws' | 'do-rpc'

const getTransportFromContext = (ctx: unknown): Transport => {
  if (typeof ctx === 'object' && ctx !== null && 'transport' in (ctx as any)) {
    const t = (ctx as any).transport
    if (t === 'http' || t === 'ws' || t === 'do-rpc') return t
  }
  return 'http'
}

export class SyncBackendDO extends makeDurableObject({
  // Enable all transport modes
  enabledTransports: new Set<Transport>(['http', 'ws', 'do-rpc']),

  onPush: async (message, context) => {
    const transport = getTransportFromContext(context)
    console.log(`Push via ${transport}:`, message.batch.length)
  },
}) {}
