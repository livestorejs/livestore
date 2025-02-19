import * as http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { UnexpectedError } from '@livestore/common'
import { Effect } from '@livestore/utils/effect'
import * as Vite from 'vite'

import type { Options } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const makeViteServer = (options: Options): Effect.Effect<Vite.ViteDevServer, UnexpectedError> =>
  Effect.gen(function* () {
    const hmrPort = yield* getFreePort

    const cwd = process.cwd()

    const defaultViteConfig = Vite.defineConfig({
      server: {
        middlewareMode: true,
        hmr: {
          port: hmrPort,
        },
        fs: {
          // Adds `node_modules` so we can import `@livestore/wa-sqlite` for WASM to work
          allow: [path.resolve(__dirname, '..', '..')],
        },
      },
      resolve: {
        alias: {
          '@schema': path.resolve(cwd, options.schemaPath),
        },
      },
      appType: 'spa',
      optimizeDeps: {
        // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
        exclude: ['@livestore/wa-sqlite'],
      },
      root: __dirname,
      base: '/livestore-devtools/',
      plugins: [virtualHtmlPlugin(options.mode)],
      clearScreen: false,
      logLevel: 'silent',
    })

    const viteConfig = options.viteConfig?.(defaultViteConfig) ?? defaultViteConfig

    const viteServer = yield* Effect.promise(() => Vite.createServer(viteConfig)).pipe(
      UnexpectedError.mapToUnexpectedError,
    )

    return viteServer
  }).pipe(Effect.withSpan('@livestore/adapter-node:devtools:makeViteServer'))

// TODO unify this with `@livestore/devtools-vite/plugin.ts`
const virtualHtmlPlugin = (mode: Options['mode']): Vite.Plugin => ({
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
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { schema } from '@schema'

mountDevtools({
  schema,
  rootEl: document.getElementById('root'),
  sharedWorker,
  mode: ${JSON.stringify(mode)},
  license: ${JSON.stringify(process.env.LSD_LICENSE)},
})
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
})

export const getFreePort = Effect.async<number, UnexpectedError>((cb) => {
  const server = http.createServer()

  // Listen on port 0 to get an available port
  server.listen(0, () => {
    const address = server.address()

    if (address && typeof address === 'object') {
      const port = address.port
      server.close(() => cb(Effect.succeed(port)))
    } else {
      server.close(() => cb(UnexpectedError.make({ cause: 'Failed to get a free port' })))
    }
  })

  // Error handling in case the server encounters an error
  server.on('error', (err) => {
    server.close(() => cb(UnexpectedError.make({ cause: err })))
  })
})
