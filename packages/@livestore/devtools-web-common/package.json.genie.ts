import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'
import webmeshPkg from '../webmesh/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, utilsPkg, webmeshPkg],
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
    peerDependencies: utilsPkg.data.peerDependencies,
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
  {
    composition: runtimeDeps,
  },
)
