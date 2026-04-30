import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/sync-s2'),
  dependencies: {
    workspace: [commonPkg, livestorePkg, utilsPkg],
  },
  devDependencies: {
    external: catalog.pick(...utilsEffectPeerDeps, 'vitest'),
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
  },
})

export default packageJson(
  {
    name: '@livestore/sync-s2',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './s2-proxy-helpers': './src/s2-proxy-helpers.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
        './s2-proxy-helpers': './dist/s2-proxy-helpers.js',
      },
    },
    scripts: {
      build: '',
      test: "echo 'No tests yet'",
    },
  },
  runtimeDeps,
)
