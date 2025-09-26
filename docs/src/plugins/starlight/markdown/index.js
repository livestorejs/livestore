// Local drop-in for starlight-markdown until upstream fix lands.
// Upstream issue: https://github.com/reynaldichernando/starlight-markdown/issues/1
// Upstream PR: https://github.com/reynaldichernando/starlight-markdown/pull/2
// Local tracking issue: https://github.com/livestorejs/livestore/issues/699
// TODO: Delete this local integration and the alias in astro.config.mjs once upstream is fixed.
export function starlightMarkdownIntegration() {
  return {
    name: 'starlight-markdown',
    hooks: {
      'astro:config:setup': async ({ injectRoute }) => {
        injectRoute({
          pattern: '/index.md',
          entrypoint: '@local/starlight-markdown/markdown.js',
        })
        injectRoute({
          pattern: '/[...path]/index.md',
          entrypoint: '@local/starlight-markdown/markdown.js',
        })
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
