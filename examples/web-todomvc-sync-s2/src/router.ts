import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen.ts'

export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
  })
