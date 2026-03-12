import { catalog, livestorePackageDefaults, packageJson, utilsEffectPeerDeps } from '../../../genie/repo.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [utilsPkg],
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick(...utilsEffectPeerDeps, 'vitest'),
  },
})

export default packageJson(
  {
    name: '@livestore/webmesh',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
    },
    // Re-expose utils' peer dependencies
    peerDependencies: utilsPkg.data.peerDependencies,
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
      },
    },
    scripts: {
      test: 'vitest',
    },
  },
  runtimeDeps,
)
