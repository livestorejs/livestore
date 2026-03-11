import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, utilsPkg],
  },
  devDependencies: {
    external: catalog.pick(...utilsEffectPeerDeps),
  },
})

export default packageJson(
  {
    name: '@livestore/sync-electric',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/index.ts',
    },
    peerDependencies: utilsPkg.data.peerDependencies,
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
  {
    composition: runtimeDeps,
  },
)
