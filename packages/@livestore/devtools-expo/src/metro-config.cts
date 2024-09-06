import type * as http from 'node:http'

import type { MetroConfig } from 'expo/metro-config'

import type { Middleware, Options } from '../types.js'

/**
 * Patches the Metro config to add a middleware via `config.server.enhanceMiddleware`.
 */
const addLiveStoreDevtoolsMiddleware = (config: MutableDeep<MetroConfig>, options: Options) => {
  const viteMiddleware = makeLiveStoreDevtoolsMiddleware(options)

  const previousEnhanceMiddleware = config.server.enhanceMiddleware as (
    metroMiddleware: Middleware,
    server: any,
  ) => Middleware

  const enhanceMiddleware = (metroMiddleware: Middleware, server: any): Middleware => {
    const enhancedMiddleware = previousEnhanceMiddleware(metroMiddleware, server)

    return (req, res, next) =>
      req.url?.startsWith('/livestore-devtools')
        ? viteMiddleware(req, res, () => enhancedMiddleware(req, res, next))
        : enhancedMiddleware(req, res, next)
  }

  config.server.enhanceMiddleware = enhanceMiddleware
}

const makeLiveStoreDevtoolsMiddleware = (options: Options) => {
  // const viteServerPromise = makeViteServer(options)
  const viteServerPromise = import('./vite-dev-server.mjs').then(({ makeViteServer }) => makeViteServer(options))

  const middleware = async (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    if (req.url?.startsWith('/livestore-devtools') == false) {
      return next()
    }

    const viteServer = await viteServerPromise

    return viteServer.middlewares(req, res, next)
  }

  return middleware
}

/** Remove readonly from all properties */
type MutableDeep<T> = {
  -readonly [P in keyof T]: MutableDeep<T[P]>
}

// eslint-disable-next-line unicorn/prefer-module
module.exports = {
  addLiveStoreDevtoolsMiddleware,
  makeLiveStoreDevtoolsMiddleware,
}

export type { addLiveStoreDevtoolsMiddleware, makeLiveStoreDevtoolsMiddleware }
