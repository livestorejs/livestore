import { fileURLToPath } from 'node:url'

import { Effect, Fiber } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import type { AstroIntegration } from 'astro'

import { type BuildSnippetsOptions, buildSnippets, watchSnippets } from '../cli/snippets.ts'
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

/** When set, skip auto-build and watch (snippets are managed externally, e.g. by mono CLI) */
const shouldSkipSnippetAutoBuildAndWatch = () => process.env.LS_SKIP_SNIPPET_AUTO_BUILD_AND_WATCH === '1'

export const createAstroTwoslashCodeIntegration = (options: AstroTwoslashCodeOptions = {}): AstroIntegration => {
  const autoBuild = options.autoBuild ?? true
  let resolvedBuildOptions: BuildSnippetsOptions | undefined
  let watchFiber: Fiber.RuntimeFiber<void, never> | null = null

  const runSnippetBuild = () => {
    if (!resolvedBuildOptions) {
      return Promise.resolve()
    }

    return buildSnippets(resolvedBuildOptions).pipe(
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Effect.runPromise,
    )
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
        if (!autoBuild || shouldSkipSnippetAutoBuildAndWatch()) {
          return
        }

        await runSnippetBuild()

        if (resolvedBuildOptions && watchFiber === null) {
          const watchEffect = watchSnippets(resolvedBuildOptions)
          watchFiber = Effect.runFork(watchEffect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer)))
        }
      },
      'astro:build:start': async (_context: BuildStartContext) => {
        if (!autoBuild || shouldSkipSnippetAutoBuildAndWatch()) {
          return
        }

        await runSnippetBuild()
      },
      'astro:server:done': async () => {
        if (watchFiber !== null) {
          await Effect.runPromise(Fiber.interrupt(watchFiber))
          watchFiber = null
        }
      },
    },
  }
}
