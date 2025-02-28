import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import * as Vite from 'vite'

import type { Options } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const makeViteServer = async (options: Options): Promise<Vite.ViteDevServer> => {
  const hmrPort = await getFreePort.pipe(Effect.runPromise)

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
import sharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { schema } from '@schema'

mountDevtools({ schema, rootEl: document.getElementById('root'), sharedWorker, mode: 'expo' })
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
