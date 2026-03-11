import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../../@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [utilsPkg],
    external: catalog.pick('@kitschpatrol/tldraw-cli'),
  },
  devDependencies: {
    external: effectDevDeps('@effect/vitest', '@types/node', 'astro', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@local/astro-tldraw',
    exports: {
      '.': './src/mod.ts',
      './integration': './src/integration.ts',
      './vite': './src/vite-plugin.ts',
      './components/TldrawDiagram.astro': './src/components/TldrawDiagram.astro',
    },
    ...localPackageDefaults,
    peerDependencies: {
      astro: '^5.0.0',
    },
  },
  {
    composition: runtimeDeps,
  },
)
