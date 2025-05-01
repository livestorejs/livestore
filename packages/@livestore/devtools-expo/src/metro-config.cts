// eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module, @typescript-eslint/consistent-type-imports, prettier/prettier
const { Effect, Logger, LogLevel } = require('@livestore/utils/effect') as typeof import('@livestore/utils/effect', { with: { "resolution-mode": "import" } })

// eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module, @typescript-eslint/consistent-type-imports, prettier/prettier
const { PlatformNode } = require('@livestore/utils/node') as typeof import('@livestore/utils/node', { with: { "resolution-mode": "import" } })

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
  const host = options.host ?? 'localhost'
  const port = options.port ?? 4242

  // Needed for @livestore/adapter-expo
  process.env.EXPO_PUBLIC_LIVESTORE_DEVTOOLS_URL = `http://${host}:${port}`

  import('@livestore/adapter-node/devtools')
    .then(async ({ startDevtoolsServer }) => {
      startDevtoolsServer({
        clientSessionInfo: undefined,
        schemaPath: options.schemaPath,
        host,
        port,
      }).pipe(
        Effect.provide(PlatformNode.NodeHttpClient.layer),
        Effect.provide(Logger.prettyWithThread('@livestore/devtools-expo:metro-config')),
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.tapCauseLogPretty,
        Effect.runPromise,
      )
    })
    .catch((error) => {
      console.error(error)
    })

  const previousEnhanceMiddleware = config.server.enhanceMiddleware as (
    metroMiddleware: Middleware,
    server: any,
  ) => Middleware

  /** Redirects requests to LiveStore DevTools to `http://${host}:${port}/_livestore/${...}` */
  const redirectMiddleware: Middleware = (req, res, next) => {
    if (req.url?.startsWith('/_livestore') == false) {
      return next()
    }

    const redirectUrl = `http://${host}:${port}/_livestore/${req.url!.slice('/_livestore'.length)}`
    res.writeHead(302, { Location: redirectUrl })
    res.end()
  }

  const enhanceMiddleware = (metroMiddleware: Middleware, server: any): Middleware => {
    const enhancedMiddleware = previousEnhanceMiddleware(metroMiddleware, server)

    return (req, res, next) =>
      req.url?.startsWith('/_livestore')
        ? redirectMiddleware(req, res, () => enhancedMiddleware(req, res, next))
        : enhancedMiddleware(req, res, next)
  }

  config.server.enhanceMiddleware = enhanceMiddleware
}

/** Remove readonly from all properties */
type MutableDeep<T> = {
  -readonly [P in keyof T]: MutableDeep<T[P]>
}

// eslint-disable-next-line unicorn/prefer-module
module.exports = {
  addLiveStoreDevtoolsMiddleware,
}

export type { addLiveStoreDevtoolsMiddleware }
export type { Options } from './types.js'
