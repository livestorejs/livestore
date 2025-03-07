import type * as http from 'node:http'

// eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module, @typescript-eslint/consistent-type-imports
const { Effect } = require('@livestore/utils/effect') as typeof import('@livestore/utils/effect')

import type { MetroConfig } from 'expo/metro-config'

import type { Middleware, Options } from './types.js'

/**
 * Patches the Metro config to add a middleware via `config.server.enhanceMiddleware`.
 */
const addLiveStoreDevtoolsMiddleware = (config: MutableDeep<MetroConfig>, options: Options) => {
  // NOTE in CI we want to skip this
  if (process.env.CI || !process.stdout.isTTY) {
    return
  }

  const viteMiddleware = makeLiveStoreDevtoolsMiddleware(options)

  const previousEnhanceMiddleware = config.server.enhanceMiddleware as (
    metroMiddleware: Middleware,
    server: any,
  ) => Middleware

  const enhanceMiddleware = (metroMiddleware: Middleware, server: any): Middleware => {
    const enhancedMiddleware = previousEnhanceMiddleware(metroMiddleware, server)

    return (req, res, next) =>
      req.url?.startsWith('/_livestore')
        ? viteMiddleware(req, res, () => enhancedMiddleware(req, res, next))
        : enhancedMiddleware(req, res, next)
  }

  config.server.enhanceMiddleware = enhanceMiddleware
}

const makeLiveStoreDevtoolsMiddleware = (options: Options) => {
  // TODO Once Expo supports proper ESM, we can make this a static import
  // const viteServerPromise = makeViteServer(options)
  const viteServerPromise = import('@livestore/adapter-node/devtools').then(({ makeViteServer }) =>
    makeViteServer({
      ...options,
      mode: {
        _tag: 'expo',
        storeId: options.storeId ?? 'default',
        clientId: options.clientId ?? 'expo',
        sessionId: options.sessionId ?? 'expo',
      },
    }).pipe(Effect.runPromise),
  )

  const middleware = async (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    if (req.url?.startsWith('/_livestore') == false) {
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
export type { Options } from './types.js'
