import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonCfPkg from '../common-cf/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/sync-cf'),
  dependencies: {
    workspace: [commonPkg, commonCfPkg, utilsPkg],
    external: catalog.pick('@cloudflare/workers-types'),
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
    name: '@livestore/sync-cf',
    ...livestorePackageDefaults,
    exports: {
      './client': './src/client/mod.ts',
      './common': './src/common/mod.ts',
      './cf-worker': './src/cf-worker/mod.ts',
    },
    files: [...livestorePackageDefaults.files, 'README.md'],
    publishConfig: {
      access: 'public',
      exports: {
        './client': './dist/client/mod.js',
        './common': './dist/common/mod.js',
        './cf-worker': './dist/cf-worker/mod.js',
      },
    },
    scripts: {
      test: "echo 'No tests yet'",
    },
  },
  runtimeDeps,
)
