import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../../@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [utilsPkg],
    external: catalog.pick(
      '@effect/platform-node',
      'astro-expressive-code',
      'expressive-code',
      'expressive-code-twoslash',
      'hast',
      'hast-util-to-html',
      'typescript',
    ),
  },
  devDependencies: {
    external: effectDevDeps('@astrojs/starlight', '@types/hast', '@types/node', 'astro', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@local/astro-twoslash-code',
    exports: {
      '.': './src/mod.ts',
      './cli': './src/cli/snippets.ts',
      './integration': './src/integration/astro-twoslash-code.ts',
      './vite': './src/vite/vite-plugin-snippet.ts',
      './components/multi-code': './src/components/multi-code.ts',
      './components/MultiCode.astro': './src/components/MultiCode.astro',
    },
    ...localPackageDefaults,
    peerDependencies: {
      '@astrojs/starlight': '^0.35.0',
      astro: '^5.0.0',
    },
  },
  runtimeDeps,
)
