import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StarlightPlugin } from '@astrojs/starlight/types'
import type { AstroUserConfig, ViteUserConfig } from 'astro'
import { z } from 'astro/zod'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export interface MixedbreadClientOptions {
  /** Your Mixedbread API key */
  apiKey: string
  /** Your Vector Store ID */
  vectorStoreId: string
  /** The maximum number of results to return per search */
  maxResults?: number
  /** Base URL for the Mixedbread API */
  baseUrl?: string
  /** Disable saving recent searches and favorites to local storage */
  disableUserPersonalization?: boolean
}

/** Mixedbread Vector Search configuration options. */
const MixedbreadConfigSchema = z
  .object({
    // Required config without which Mixedbread won"t work.
    /** Your Mixedbread API key. */
    apiKey: z.string(),
    /** Your Vector Store ID. */
    vectorStoreId: z.string(),
    // Optional config
    /**
     * The maximum number of results to return per search.
     * @default 10
     */
    maxResults: z.number().optional(),
    /**
     * Base URL for the Mixedbread API.
     * @default "https://api.mixedbread.com"
     */
    baseUrl: z.string().optional(),
    /**
     * Disable saving recent searches and favorites to the local storage.
     * @default false
     */
    disableUserPersonalization: z.boolean().optional(),
  })
  .strict()
  .or(
    z
      .object({
        /**
         * The path to a JavaScript or TypeScript file containing a default export of options to
         * pass to the Mixedbread client.
         *
         * The value can be a path to a local JS/TS file relative to the root of your project,
         * e.g. `"/src/mixedbread.js"`, or an npm module specifier for a package you installed,
         * e.g. `"@company/mixedbread-config"`.
         *
         * Use `clientOptionsModule` when you need to configure options that are not serializable,
         * such as custom transformations or result processing functions.
         *
         * When `clientOptionsModule` is set, all options must be set via the module file. Other
         * inline options passed to the plugin in `astro.config.mjs` will be ignored.
         *
         * @example
         * // astro.config.mjs
         * // ...
         * starlightMixedbread({ clientOptionsModule: "./src/config/mixedbread.ts" }),
         * // ...
         *
         * // src/config/mixedbread.ts
         * import type { MixedbreadClientOptions } from "@astrojs/starlight-mixedbread";
         *
         * export default {
         *   apiKey: process.env.MXBAI_API_KEY,
         *   vectorStoreId: process.env.VECTOR_STORE_ID,
         *   maxResults: 15,
         * } satisfies MixedbreadClientOptions;
         */
        clientOptionsModule: z.string(),
      })
      .strict(),
  )

type MixedbreadUserConfig = z.infer<typeof MixedbreadConfigSchema>

/** Starlight Mixedbread plugin. */
export const starlightMixedbread = (userConfig: MixedbreadUserConfig): StarlightPlugin => {
  const opts = MixedbreadConfigSchema.parse(userConfig)
  return {
    name: 'starlight-mixedbread',
    hooks: {
      'config:setup'({ addIntegration, config, logger, updateConfig }) {
        // If the user has already has a custom override for the Search component, don"t override it.
        if (config.components?.Search) {
          logger.warn('It looks like you already have a `Search` component override in your Starlight configuration.')
          logger.warn('To render `@astrojs/starlight-mixedbread`, remove the override for the `Search` component.\n')
        } else {
          // Otherwise, add the Search component override to the user"s configuration.
          updateConfig({
            pagefind: false,
            components: {
              ...config.components,
              Search: resolve(__dirname, 'Search.astro'),
            },
          })
        }

        // Add an Astro integration that injects a Vite plugin to expose
        // the Mixedbread config via a virtual module.
        addIntegration({
          name: 'starlight-mixedbread',
          hooks: {
            'astro:config:setup': ({ config, updateConfig }) => {
              updateConfig({
                vite: {
                  plugins: [vitePluginMixedbread(config.root, opts)],
                },
              } satisfies AstroUserConfig)
            },
          },
        })
      },
    },
  }
}

/** Vite plugin that exposes the Mixedbread config via virtual modules. */
function vitePluginMixedbread(root: URL, config: MixedbreadUserConfig): VitePlugin {
  const moduleId = 'virtual:starlight/mixedbread-config'
  const resolvedModuleId = `\0${moduleId}`

  const resolveId = (id: string, base = root) =>
    JSON.stringify(id.startsWith('.') ? resolve(fileURLToPath(base), id) : id)

  const moduleContent = `
	${
    'clientOptionsModule' in config
      ? `export { default } from ${resolveId(config.clientOptionsModule)};`
      : `export default ${JSON.stringify(config)};`
  }
	`

  return {
    name: 'vite-plugin-starlight-mixedbread-config',
    load(id) {
      return id === resolvedModuleId ? moduleContent : undefined
    },
    resolveId(id) {
      return id === moduleId ? resolvedModuleId : undefined
    },
  }
}

type VitePlugin = NonNullable<ViteUserConfig['plugins']>[number]
