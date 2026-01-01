import { StoreRegistry } from '@livestore/react'
import { createRouter } from '@tanstack/react-router'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { routeTree } from './routeTree.gen.ts'

export const getRouter = () => {
  const storeRegistry = new StoreRegistry({ defaultOptions: { batchUpdates } })

  return createRouter({
    routeTree,
    context: {
      storeRegistry,
    },
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
