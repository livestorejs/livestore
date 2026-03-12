import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/sync-electric'),
  dependencies: {
    workspace: [commonPkg, utilsPkg],
  },
  devDependencies: {
    external: catalog.pick(...utilsEffectPeerDeps),
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
  },
})

export default packageJson(
  {
    name: '@livestore/sync-electric',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/index.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/index.js',
      },
    },
    scripts: {
      build: '',
      test: "echo 'No tests yet'",
    },
  },
  runtimeDeps,
)
