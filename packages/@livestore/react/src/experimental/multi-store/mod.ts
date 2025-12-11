// Re-export from @livestore/livestore for backwards compatibility
export { type CachedStoreOptions, StoreRegistry, storeOptions } from '@livestore/livestore'
// Re-export React hooks/components for convenience
export { StoreRegistryProvider, useStoreRegistry } from '../../StoreRegistryContext.tsx'
export { useStore } from '../../useStore.ts'
