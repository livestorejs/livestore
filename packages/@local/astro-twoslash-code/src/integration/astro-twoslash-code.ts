import { fileURLToPath } from 'node:url'

import type { AstroIntegration } from 'astro'
import type { TwoslashRuntimeOptions } from '../expressive-code.ts'
import { createTwoslashSnippetPlugin } from '../vite/vite-plugin-snippet.ts'

export type AstroTwoslashCodeOptions = {
  projectRoot?: string
  runtime?: TwoslashRuntimeOptions
}

type ConfigSetupContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:config:setup']>>[0]

export const createAstroTwoslashCodeIntegration = (options: AstroTwoslashCodeOptions = {}): AstroIntegration => ({
  name: '@local/astro-twoslash-code/integration',
  hooks: {
    'astro:config:setup'(context: ConfigSetupContext) {
      const { updateConfig, config } = context
      const projectRoot = options.projectRoot ?? fileURLToPath(config.root)

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
  },
})
