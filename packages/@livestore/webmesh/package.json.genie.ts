import {
  catalog,
  getUtilsPeerDeps,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
  workspaceMember,
} from '../../../genie/repo.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/webmesh'),
  dependencies: {
    workspace: [utilsPkg],
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick(...utilsEffectPeerDeps, '@types/node', 'vitest'),
  },
  // Re-expose utils' peer dependencies
  peerDependencies: {
    external: getUtilsPeerDeps(),
  },
})

export default packageJson(
  {
    name: '@livestore/webmesh',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './worker': './src/worker/mod.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
        './worker': './dist/worker/mod.js',
      },
    },
    scripts: {
      test: 'vitest',
    },
  },
  runtimeDeps,
)
