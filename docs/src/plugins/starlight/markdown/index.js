/**
 * LiveStore-owned replacement for the upstream `starlight-markdown` integration.
 *
 * The contextual menu plugin still eagerly imports `starlight-markdown` and expects
 * the same integration surface (two markdown routes plus an integration wrapper).
 * We keep this module under our control so we can normalise slugs and prevent Astro
 * from serving HTML fallbacks when the contextual menu fetches `*.md` routes.
 *
 * Any changes here need to remain API-compatible with the upstream package because
 * `starlight-contextual-menu` imports it before Astro applies our aliases.
 */
let routesInjected = false

export function starlightMarkdownIntegration() {
  return {
    name: 'starlight-markdown',
    hooks: {
      'astro:config:setup': async ({ injectRoute }) => {
        if (routesInjected) return

        injectRoute({
          pattern: '/index.md',
          entrypoint: 'src/plugins/starlight/markdown/markdown.js',
        })
        injectRoute({
          pattern: '/[...path]/index.md',
          entrypoint: 'src/plugins/starlight/markdown/markdown.js',
        })

        routesInjected = true
      },
    },
  }
}

export default function starlightMarkdown() {
  return {
    name: 'starlight-markdown',
    hooks: {
      'config:setup'({ addIntegration }) {
        addIntegration(starlightMarkdownIntegration())
      },
    },
  }
}
