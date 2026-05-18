import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'
import webmeshPkg from '../webmesh/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/devtools-web-common'),
  dependencies: {
    workspace: [commonPkg, utilsPkg, webmeshPkg],
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
  },
})

export default packageJson(
  {
    name: '@livestore/devtools-web-common',
    ...livestorePackageDefaults,
    exports: {
      './web-channel': './src/web-channel/index.ts',
      './worker': './src/worker/mod.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        './web-channel': './dist/web-channel/index.js',
        './worker': './dist/worker/mod.js',
      },
    },
    scripts: {
      test: 'echo No tests yet',
    },
  },
  runtimeDeps,
)
