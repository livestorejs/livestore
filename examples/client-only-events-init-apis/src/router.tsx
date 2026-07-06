import type { StoreRegistry } from '@livestore/livestore'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen.ts'
import { clientOnlyEventsStoreOptions, storeRegistry, type ClientOnlyEventsStoreOptions } from './store.ts'

/**
 * Dependencies made available to TanStack Router loaders and route components.
 *
 * Keep LiveStore dependencies in router context instead of importing mutable
 * singletons inside route files. This makes route-loader initialization explicit
 * and keeps each example page easy to inspect.
 */
export interface ClientOnlyEventsRouterContext {
  /** Registry used by route loaders and React components to load/reuse stores. */
  readonly storeRegistry: StoreRegistry

  /** Store options for the client-only events initialization example store. */
  readonly storeOptions: ClientOnlyEventsStoreOptions
}

export const router = createRouter({
  routeTree,
  context: {
    storeRegistry,
    storeOptions: clientOnlyEventsStoreOptions,
  } satisfies ClientOnlyEventsRouterContext,
  // Side-effectful ensure loaders should not run merely because a link was hovered.
  defaultPreload: false,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
