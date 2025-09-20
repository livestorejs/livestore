// Main exports from sync-provider
export { makeSyncBackend, type SyncS2Options } from './sync-provider.ts'

// Re-export all public APIs
export * as ApiSchema from './api-schema.ts'
export * as HttpClientGenerated from './http-client-generated.ts'
export * from './make-s2-url.ts'
export * from './s2-proxy-helpers.ts'
export type { S2SeqNum as S2SeqNumType, SyncMetadata as SyncMetadataType } from './types.ts'
export { S2SeqNum, SyncMetadata, s2SeqNum } from './types.ts'