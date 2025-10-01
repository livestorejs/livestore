import { fileURLToPath } from 'node:url'

import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import type { AstroIntegration } from 'astro'

import { type BuildSnippetsOptions, buildSnippets } from '../cli/snippets.ts'
import type { TwoslashRuntimeOptions } from '../expressive-code.ts'
import { createTwoslashSnippetPlugin } from '../vite/vite-plugin-snippet.ts'

export type AstroTwoslashCodeOptions = {
  autoBuild?: boolean
  buildOptions?: BuildSnippetsOptions
  projectRoot?: string
  runtime?: TwoslashRuntimeOptions
}

type ConfigSetupContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:config:setup']>>[0]
type ServerStartContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:server:start']>>[0]
type BuildStartContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:build:start']>>[0]

const provideNodeFileSystem = <T, E, R>(effect: Effect.Effect<T, E, R>) =>
  effect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

const shouldSkipAutoBuild = () => process.env.LS_TWOSLASH_SKIP_AUTO_BUILD === '1'

export const createAstroTwoslashCodeIntegration = (options: AstroTwoslashCodeOptions = {}): AstroIntegration => {
  const autoBuild = options.autoBuild ?? true
  let resolvedBuildOptions: BuildSnippetsOptions | undefined

  const runSnippetBuild = () => {
    if (!resolvedBuildOptions) {
      return Promise.resolve()
    }

    return Effect.runPromise(provideNodeFileSystem(buildSnippets(resolvedBuildOptions)))
  }

  return {
    name: '@local/astro-twoslash-code/integration',
    hooks: {
      'astro:config:setup': (context: ConfigSetupContext) => {
        const { updateConfig, config } = context
        const projectRoot = options.projectRoot ?? fileURLToPath(config.root)

        resolvedBuildOptions = {
          projectRoot,
          ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
          ...(options.buildOptions ?? {}),
        }

        const pluginOptions = {
          projectRoot,
          ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
        }

        const plugin = createTwoslashSnippetPlugin(pluginOptions)
        const existingPlugins = config.vite?.plugins ?? []

        updateConfig({
          vite: {
            plugins: [...existingPlugins, plugin] as typeof existingPlugins,
          },
        })
      },
      'astro:server:start': async (_context: ServerStartContext) => {
        if (!autoBuild || shouldSkipAutoBuild()) {
          return
        }

        await runSnippetBuild()
      },
      'astro:build:start': async (_context: BuildStartContext) => {
        if (!autoBuild || shouldSkipAutoBuild()) {
          return
        }

        await runSnippetBuild()
      },
    },
  }
}
