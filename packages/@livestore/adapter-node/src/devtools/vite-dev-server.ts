import * as http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Devtools } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { Effect } from '@livestore/utils/effect'
import * as Vite from 'vite'

export type ViteDevtoolsOptions = {
  viteConfig?: (config: Vite.UserConfig) => Vite.UserConfig
  /**
   * Path to the file exporting the LiveStore schema as `export const schema = ...`
   * File path must be relative to the project root and will be imported via Vite.
   *
   * Example: `./src/schema.ts`
   */
  schemaPath: string
  /**
   * The mode of the devtools server.
   *
   * @default 'node'
   */
  mode: Extract<Devtools.DevtoolsMode, { _tag: 'node' } | { _tag: 'expo' }>
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// NOTE this is currently also used in @livestore/devtools-expo
export const makeViteServer = (options: ViteDevtoolsOptions): Effect.Effect<Vite.ViteDevServer, UnexpectedError> =>
  Effect.gen(function* () {
    const hmrPort = yield* getFreePort

    const cwd = process.cwd()

    const defaultViteConfig = Vite.defineConfig({
      server: {
        middlewareMode: true,
        hmr: {
          port: hmrPort,
        },
        // Relaxing fs access for monorepo setup
        fs: { strict: process.env.LS_DEV ? false : true },
      },
      appType: 'spa',
      optimizeDeps: {
        // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
        exclude: ['@livestore/wa-sqlite'],
      },
      root: __dirname,
      base: '/_livestore/',
      plugins: [
        livestoreDevtoolsPlugin({
          schemaPath: path.resolve(cwd, options.schemaPath),
          mode: options.mode,
          path: '/',
        }),
      ],
      clearScreen: false,
      logLevel: 'silent',
    })

    const viteConfig = options.viteConfig?.(defaultViteConfig) ?? defaultViteConfig

    const viteServer = yield* Effect.promise(() => Vite.createServer(viteConfig)).pipe(
      UnexpectedError.mapToUnexpectedError,
    )

    return viteServer
  }).pipe(Effect.withSpan('@livestore/adapter-node:devtools:makeViteServer'))

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
