import { catalog, packageJson, workspaceMember } from '../genie/repo.ts'
import adapterCloudflarePkg from '../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import adapterExpoPkg from '../packages/@livestore/adapter-expo/package.json.genie.ts'
import adapterNodePkg from '../packages/@livestore/adapter-node/package.json.genie.ts'
import adapterWebPkg from '../packages/@livestore/adapter-web/package.json.genie.ts'
import commonPkg from '../packages/@livestore/common/package.json.genie.ts'
import livestorePkg from '../packages/@livestore/livestore/package.json.genie.ts'
import reactPkg from '../packages/@livestore/react/package.json.genie.ts'
import solidPkg from '../packages/@livestore/solid/package.json.genie.ts'
import syncCfPkg from '../packages/@livestore/sync-cf/package.json.genie.ts'
import syncElectricPkg from '../packages/@livestore/sync-electric/package.json.genie.ts'
import syncS2Pkg from '../packages/@livestore/sync-s2/package.json.genie.ts'
import utilsPkg from '../packages/@livestore/utils/package.json.genie.ts'
import localAstroTldrawPkg from '../packages/@local/astro-tldraw/package.json.genie.ts'
import localAstroTwoslashCodePkg from '../packages/@local/astro-twoslash-code/package.json.genie.ts'
import localSharedPkg from '../packages/@local/shared/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('docs'),
  dependencies: {
    workspace: [
      adapterCloudflarePkg,
      adapterExpoPkg,
      adapterNodePkg,
      adapterWebPkg,
      commonPkg,
      livestorePkg,
      reactPkg,
      solidPkg,
      syncCfPkg,
      syncElectricPkg,
      syncS2Pkg,
      utilsPkg,
      localAstroTldrawPkg,
      localAstroTwoslashCodePkg,
      localSharedPkg,
    ],
    external: {
      ...catalog.pick(
        'solid-js',
        'expo-application',
        'expo-sqlite',
        '@astrojs/starlight',
        'astro',
        'typedoc',
        'react',
        'react-dom',
        '@types/react',
        'tailwindcss',
      ),
      ...catalog.pick('@livestore/devtools-vite'),
      '@astrojs/check': '0.9.4',
      '@astrojs/netlify': '6.5.9',
      '@astrojs/react': '4.3.0',
      '@astrojs/starlight-tailwind': '4.0.1',
      '@mixedbread/cli': '1.2.1',
      '@mixedbread/sdk': '0.28.1',
      '@tailwindcss/vite': '4.1.18',
      'astro-d2': '0.8.1',
      'astro-og-canvas': '0.7.0',
      'canvaskit-wasm': '0.40.0',
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
  },
  devDependencies: {
    external: catalog.pick('@playwright/test', '@types/react-dom', '@types/hast', 'vitest'),
  },
  mode: 'install',
})

export default packageJson(
  {
    name: '@local/docs',
    version: '0.1.1',
    type: 'module',
    private: true,
    exports: {
      './multi-code-markdown': './src/utils/multi-code-markdown.ts',
      './sidebar': './src/data/sidebar.ts',
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
  },
  runtimeDeps,
)
