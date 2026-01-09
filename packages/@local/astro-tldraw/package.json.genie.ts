import { localPackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@local/astro-tldraw',
  exports: {
    '.': './src/mod.ts',
    './integration': './src/integration.ts',
    './vite': './src/vite-plugin.ts',
    './components/TldrawDiagram.astro': './src/components/TldrawDiagram.astro',
  },
  dependencies: ['@kitschpatrol/tldraw-cli', '@livestore/utils'],
  devDependencies: ['@effect/vitest', '@types/node', 'astro', 'vitest'],
  ...localPackageDefaults,
  peerDependencies: {
    astro: '^5.0.0',
  },
})
