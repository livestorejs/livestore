declare global {
  // eslint-disable-next-line no-var
  var __debugLiveStore: Record<string, unknown> | undefined
}

/**
 * Exposes a store instance on the global object for browser console debugging.
 *
 * The store is accessible via `globalThis.__debugLiveStore`:
 * - `__debugLiveStore._` - The first store registered (convenience shortcut)
 * - `__debugLiveStore[storeId]` - Store by its storeId or debug instanceId
 *
 * @param store - The store instance to expose
 * @param storeId - The store's identifier (storeId or debug.instanceId)
 */
export const exposeStoreForDebugging = (store: unknown, storeId: string): void => {
  globalThis.__debugLiveStore ??= {}
  if (Object.keys(globalThis.__debugLiveStore).length === 0) {
    globalThis.__debugLiveStore._ = store
  }
  globalThis.__debugLiveStore[storeId] = store
}
