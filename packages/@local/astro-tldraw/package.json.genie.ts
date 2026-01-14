import { catalog, localPackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@local/astro-tldraw',
  exports: {
    '.': './src/mod.ts',
    './integration': './src/integration.ts',
    './vite': './src/vite-plugin.ts',
    './components/TldrawDiagram.astro': './src/components/TldrawDiagram.astro',
  },
  dependencies: {
    ...catalog.pick('@kitschpatrol/tldraw-cli', '@livestore/utils'),
  },
  devDependencies: {
    ...catalog.pick('@effect/vitest', '@types/node', 'astro', 'vitest'),
  },
  ...localPackageDefaults,
  peerDependencies: {
    astro: '^5.0.0',
  },
})
