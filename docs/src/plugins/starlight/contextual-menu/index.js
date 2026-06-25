/**
 * LiveStore-vendored copy of `starlight-contextual-menu` (upstream 0.1.3, MIT, by Corsfix).
 *
 * Upstream is pinned to `astro@^5` and unmaintained for Astro 6, so we vendor its small
 * source rather than carry an npm dep + pnpm peer override. The client script lives in the
 * sibling `contextual-menu.js` (verbatim from upstream).
 *
 * Differences from upstream:
 * - The markdown integration is imported from our local `starlight-markdown` drop-in
 *   (`../markdown/index.js`) instead of the npm package.
 * - Honour an `injectMarkdownRoutes` option: when `false`, we don't register the markdown
 *   routes here because the docs config adds `starlightMarkdown()` to the plugins list
 *   separately (the local integration is idempotent, but skipping is cleaner).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { starlightMarkdownIntegration } from '../markdown/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function starlightContextualMenuIntegration(options) {
  const config = {
    actions: ['copy', 'view'], // Default actions
    ...options,
  }

  return {
    name: 'starlight-contextual-menu',
    hooks: {
      'astro:config:setup': async ({ injectScript }) => {
        const contextualMenuContent = readFileSync(join(__dirname, 'contextual-menu.js'), 'utf-8')

        injectScript(
          'page',
          `
            ${contextualMenuContent};
            initContextualMenu(${JSON.stringify({
              actions: config.actions,
            })});
          `,
        )
      },
    },
  }
}

export default function starlightContextualMenu(userConfig) {
  return {
    name: 'starlight-contextual-menu-plugin',
    hooks: {
      'config:setup'({ addIntegration }) {
        if (userConfig?.injectMarkdownRoutes !== false) {
          addIntegration(starlightMarkdownIntegration(userConfig))
        }
        addIntegration(starlightContextualMenuIntegration(userConfig))
      },
    },
  }
}
