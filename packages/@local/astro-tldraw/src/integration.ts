import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { type BuildDiagramsOptions, buildDiagrams } from './cli.ts'
import { createTldrawPlugin } from './vite-plugin.ts'

export interface AstroTldrawOptions {
  autoBuild?: boolean
  buildOptions?: Partial<BuildDiagramsOptions>
  projectRoot?: string
}

type ConfigSetupContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:config:setup']>>[0]
type ServerStartContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:server:start']>>[0]
type BuildStartContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:build:start']>>[0]

const shouldSkipAutoBuild = () => process.env.LS_TLDRAW_SKIP_AUTO_BUILD === '1'

export const createAstroTldrawIntegration = (options: AstroTldrawOptions = {}): AstroIntegration => {
  const autoBuild = options.autoBuild ?? true
  let resolvedBuildOptions: BuildDiagramsOptions | undefined

  const runDiagramBuild = () => {
    if (!resolvedBuildOptions) {
      return Promise.resolve()
    }

    return buildDiagrams(resolvedBuildOptions)
  }

  return {
    name: '@local/astro-tldraw/integration',
    hooks: {
      'astro:config:setup': (context: ConfigSetupContext) => {
        const { updateConfig, config } = context
        const projectRoot = options.projectRoot ?? fileURLToPath(config.root)

        resolvedBuildOptions = {
          projectRoot,
          verbose: process.env.NODE_ENV !== 'production',
          ...options.buildOptions,
        }

        const pluginOptions = {
          projectRoot,
        }

        const plugin = createTldrawPlugin(pluginOptions)
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

        await runDiagramBuild()
      },
      'astro:build:start': async (_context: BuildStartContext) => {
        if (!autoBuild || shouldSkipAutoBuild()) {
          return
        }

        await runDiagramBuild()
      },
    },
  }
}
