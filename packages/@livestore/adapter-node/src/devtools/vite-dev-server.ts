import path from 'node:path'

import type { Devtools } from '@livestore/common'
import { UnknownError } from '@livestore/common'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { isReadonlyArray } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import * as Vite from 'vite'

export type ViteDevtoolsOptions = {
  viteConfig?: (config: Vite.UserConfig) => Vite.UserConfig
  /**
   * Path to the file exporting the LiveStore schema as `export const schema = ...`
   * File path must be relative to the project root and will be imported via Vite.
   *
   * Example: `./src/schema.ts`
   */
  schemaPath: string | ReadonlyArray<string>
  /**
   * The mode of the devtools server.
   *
   * @default 'node'
   */
  mode: Extract<Devtools.DevtoolsMode, { _tag: 'node' }>
}

// NOTE this is currently also used in @livestore/devtools-expo
export const makeViteMiddleware = (options: ViteDevtoolsOptions): Effect.Effect<Vite.ViteDevServer, UnknownError> =>
  Effect.gen(function* () {
    const cwd = process.cwd()

    const hmrPort = yield* getFreePort.pipe(UnknownError.mapToUnknownError)

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
      base: '/_livestore/',
      plugins: [
        livestoreDevtoolsPlugin({
          schemaPath: isReadonlyArray(options.schemaPath)
            ? options.schemaPath.map((schemaPath) => path.resolve(cwd, schemaPath))
            : path.resolve(cwd, options.schemaPath),
          mode: options.mode,
          path: '/',
        }),
      ],
      clearScreen: false,
      logLevel: 'silent',
    })

    const viteConfig = options.viteConfig?.(defaultViteConfig) ?? defaultViteConfig

    const viteServer = yield* Effect.promise(() => Vite.createServer(viteConfig)).pipe(UnknownError.mapToUnknownError)

    return viteServer
  }).pipe(Effect.withSpan('@livestore/adapter-node:devtools:makeViteServer'))
