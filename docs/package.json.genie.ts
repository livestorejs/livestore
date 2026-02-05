import { catalog, packageJson } from '../genie/repo.ts'

export default packageJson({
  name: '@local/docs',
  version: '0.1.1',
  type: 'module',
  private: true,
  exports: {
    './multi-code-markdown': './src/utils/multi-code-markdown.ts',
    './sidebar': './src/data/sidebar.ts',
  },
  dependencies: {
    // @livestore packages via catalog (uses link: protocol)
    ...catalog.pick(
      '@livestore/adapter-cloudflare',
      '@livestore/adapter-expo',
      '@livestore/adapter-node',
      '@livestore/adapter-web',
      '@livestore/common',
      '@livestore/devtools-vite',
      '@livestore/livestore',
      '@livestore/react',
      '@livestore/solid',
      '@livestore/sync-cf',
      '@livestore/sync-s2',
      '@livestore/utils',
      '@local/astro-tldraw',
      '@local/astro-twoslash-code',
      '@local/shared',
    ),

    // Astro ecosystem (from catalog where available)
    ...catalog.pick('@astrojs/starlight', 'astro', 'typedoc'),

    // React (from catalog)
    ...catalog.pick('react', 'react-dom', '@types/react'),

    // Tailwind (from catalog)
    ...catalog.pick('tailwindcss'),

    // Doc-specific Astro plugins (not in catalog)
    '@astrojs/check': '0.9.4',
    '@astrojs/netlify': '6.5.9',
    '@astrojs/react': '4.3.0',
    '@astrojs/starlight-tailwind': '4.0.1',
    '@mixedbread/cli': '1.2.1',
    '@mixedbread/sdk': '0.28.1',
    '@tailwindcss/vite': '4.1.18',
    'astro-d2': '0.8.1',
    'astro-expressive-code': '0.41.5',
    'astro-og-canvas': '0.7.0',
    'canvaskit-wasm': '0.40.0',
    'expressive-code-twoslash': '0.5.3',
    'github-slugger': '2.0.0',
    'rehype-mermaid': '3.0.0',
    'remark-custom-header-id': '1.0.0',
    'remove-markdown': '0.6.2',
    sharp: '0.34.3',
    'starlight-auto-sidebar': '0.1.2',
    'starlight-contextual-menu': '0.1.3',
    'starlight-links-validator': '0.17.1',
    'starlight-markdown': '0.1.5',
    'starlight-sidebar-topics': '0.6.0',
    'starlight-typedoc': '0.21.3',
    'terrastruct-d2-bin': '0.7.1',
    'typedoc-plugin-markdown': '4.8.1',
    typescript: '5.9.3',
    'unist-util-visit': '5.0.0',
  },
  devDependencies: {
    ...catalog.pick('@playwright/test', '@types/react-dom', '@types/hast', 'vitest'),
  },
  scripts: {
    astro: 'astro',
    build: 'astro check && astro build',
    dev: 'astro dev',
    'dev:docs:sync':
      'mxbai vs sync "livestore-docs-dev" "./src/content/**/*.mdx" "./src/content/**/*.md"  --yes --strategy fast',
    'dev:docs:sync:dry-run':
      'mxbai vs sync "livestore-docs-dev" "./src/content/**/*.mdx" "./src/content/**/*.md" --dry-run',
    preview: 'astro preview',
    start: 'astro dev',
  },
})
