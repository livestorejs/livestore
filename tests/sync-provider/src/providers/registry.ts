import * as CloudflareDoRpcProvider from './cloudflare-do-rpc.ts'
import * as CloudflareHttpProvider from './cloudflare-http-rpc.ts'
import * as CloudflareWsProvider from './cloudflare-ws.ts'
import * as ElectricProvider from './electric.ts'
import * as MockProvider from './mock.ts'
import * as S2Provider from './s2.ts'

// Single source of truth for sync providers used across CLI and tests
export const providerRegistry = {
  mock: { name: MockProvider.name, layer: MockProvider.layer, prepare: MockProvider.prepare },
  electric: { name: ElectricProvider.name, layer: ElectricProvider.layer, prepare: ElectricProvider.prepare },
  s2: { name: S2Provider.name, layer: S2Provider.layer, prepare: S2Provider.prepare },
  'cf-http-d1': CloudflareHttpProvider.d1,
  'cf-http-do': CloudflareHttpProvider.doSqlite,
  'cf-ws-d1': CloudflareWsProvider.d1,
  'cf-ws-do': CloudflareWsProvider.doSqlite,
  'cf-do-rpc-d1': CloudflareDoRpcProvider.d1,
  'cf-do-rpc-do': CloudflareDoRpcProvider.doSqlite,
} as const

export type ProviderKey = keyof typeof providerRegistry

export const providerKeys = Object.keys(providerRegistry) as ProviderKey[]
