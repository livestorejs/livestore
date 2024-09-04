import * as http from 'node:http'
import path from 'node:path'

import type { MetroConfig } from 'expo/metro-config'
import * as Vite from 'vite'

type Middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void

type Options = {
  viteConfig?: (config: Vite.UserConfig) => Vite.UserConfig
  schemaPath: string
}

/**
 * Patches the Metro config to add a middleware via `config.server.enhanceMiddleware`.
 */
export const addLiveStoreDevtoolsMiddleware = (config: MutableDeep<MetroConfig>, options: Options) => {
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

export const makeLiveStoreDevtoolsMiddleware = (options: Options) => {
  const viteServerPromise = makeViteServer(options)

  const middleware = async (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    // console.log('req.url', req.url)
    if (req.url?.startsWith('/livestore-devtools') == false) {
      return next()
    }

    const viteServer = await viteServerPromise

    return viteServer.middlewares(req, res, next)
  }

  return middleware
}
const makeViteServer = async (options: Options) => {
  const hmrPort = await getFreePort()

  const defaultViteConfig = Vite.defineConfig({
    server: {
      middlewareMode: true,
      hmr: {
        port: hmrPort,
      },
    },
    resolve: {
      alias: {
        '@schema': path.resolve(process.cwd(), options.schemaPath),
      },
    },
    appType: 'spa',
    optimizeDeps: {
      // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
      exclude: ['@livestore/wa-sqlite'],
    },
    base: '/livestore-devtools/',
    plugins: [virtualHtmlPlugin],
  })

  const viteConfig = options.viteConfig?.(defaultViteConfig) ?? defaultViteConfig

  const viteServer = Vite.createServer(viteConfig)

  return viteServer
}

const virtualHtmlPlugin: Vite.Plugin = {
  name: 'virtual-html',
  configureServer: (server) => {
    return () => {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/' || req.url === '' || req.url === '/index.html') {
          const html = `
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="livestore-devtools" content="true" />
<title>LiveStore Devtools</title>
</head>
<body>
<div id="root"></div>
<script type="module">
import '@livestore/devtools-react/index.css'
import { mountDevtools } from '@livestore/devtools-react'
import sharedWorker from '@livestore/web/shared-worker?sharedworker'
import { schema } from '@schema'

mountDevtools({ schema, rootEl: document.getElementById('root'), sharedWorker, expo: true })
</script>
</body>
</html>
          `
          const transformedHtml = await server.transformIndexHtml(req.url, html)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(transformedHtml)
        } else {
          next()
        }
      })
    }
  },
}

const getFreePort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = http.createServer()

    // Listen on port 0 to get an available port
    server.listen(0, () => {
      const address = server.address()

      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('Failed to get a free port')))
      }
    })

    // Error handling in case the server encounters an error
    server.on('error', (err) => {
      server.close(() => reject(err))
    })
  })
}

/** Remove readonly from all properties */
type MutableDeep<T> = {
  -readonly [P in keyof T]: MutableDeep<T[P]>
}
