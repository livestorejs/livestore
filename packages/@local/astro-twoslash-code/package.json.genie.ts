import { localPackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@local/astro-twoslash-code',
  exports: {
    '.': './src/mod.ts',
    './cli': './src/cli/snippets.ts',
    './integration': './src/integration/astro-twoslash-code.ts',
    './vite': './src/vite/vite-plugin-snippet.ts',
    './components/multi-code': './src/components/multi-code.ts',
    './components/MultiCode.astro': './src/components/MultiCode.astro',
  },
  dependencies: [
    '@effect/platform-node',
    '@livestore/utils',
    'astro-expressive-code',
    'expressive-code',
    'expressive-code-twoslash',
    'hast',
    'hast-util-to-html',
    'typescript',
  ],
  devDependencies: ['@astrojs/starlight', '@types/hast', '@types/node', 'astro', 'vitest'],
  ...localPackageDefaults,
  peerDependencies: {
    '@astrojs/starlight': '^0.35.0',
    astro: '^5.0.0',
  },
})
