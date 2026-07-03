import type { StoreRegistry } from '@livestore/livestore'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen.ts'
import { clientDocumentInitStoreOptions, storeRegistry, type ClientDocumentInitStoreOptions } from './store.ts'

/**
 * Dependencies made available to TanStack Router loaders and route components.
 *
 * Keep LiveStore dependencies in router context instead of importing mutable
 * singletons inside route files. This makes route-loader initialization explicit
 * and keeps each example page easy to inspect.
 */
export interface ClientDocumentInitRouterContext {
  /** Registry used by route loaders and React components to load/reuse stores. */
  readonly storeRegistry: StoreRegistry

  /** Store options for the client-document initialization example store. */
  readonly storeOptions: ClientDocumentInitStoreOptions
}

export const router = createRouter({
  routeTree,
  context: {
    storeRegistry,
    storeOptions: clientDocumentInitStoreOptions,
  } satisfies ClientDocumentInitRouterContext,
  // Side-effectful ensure loaders should not run merely because a link was hovered.
  defaultPreload: false,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
