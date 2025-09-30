import { fileURLToPath } from 'node:url'

import type { AstroIntegration } from 'astro'
import { defaultRebuildCommand } from '../project-paths.ts'
import { createTwoslashSnippetPlugin } from '../vite/vite-plugin-snippet.ts'

export type AstroTwoslashCodeOptions = {
  projectRoot?: string
  rebuildCommand?: string
}

type ConfigSetupContext = Parameters<NonNullable<AstroIntegration['hooks']['astro:config:setup']>>[0]

export const createAstroTwoslashCodeIntegration = (options: AstroTwoslashCodeOptions = {}): AstroIntegration => ({
  name: '@local/astro-twoslash-code/integration',
  hooks: {
    'astro:config:setup'(context: ConfigSetupContext) {
      const { updateConfig, config } = context
      const projectRoot = options.projectRoot ?? fileURLToPath(config.root)
      const rebuildCommand = options.rebuildCommand ?? defaultRebuildCommand

      const plugin = createTwoslashSnippetPlugin({ projectRoot, rebuildCommand })
      const existingPlugins = config.vite?.plugins ?? []

      updateConfig({
        vite: {
          plugins: [...existingPlugins, plugin] as typeof existingPlugins,
        },
      })
    },
  },
})
