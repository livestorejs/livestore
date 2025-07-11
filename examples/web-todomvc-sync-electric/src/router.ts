import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen.ts'

export const createRouter = () => {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
