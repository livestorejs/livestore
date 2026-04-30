import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../../../genie/repo.ts'
import utilsPkg from '../../@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@local/astro-tldraw'),
  dependencies: {
    workspace: [utilsPkg],
    external: catalog.pick('@kitschpatrol/tldraw-cli'),
  },
  devDependencies: {
    external: effectDevDeps('@types/node', 'astro', 'vitest'),
  },
  peerDependencies: {
    external: {
      astro: '^5.0.0',
    },
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
  },
  runtimeDeps,
)
