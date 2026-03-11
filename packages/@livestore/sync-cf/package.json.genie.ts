import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import commonCfPkg from '../common-cf/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, commonCfPkg, utilsPkg],
    external: catalog.pick('@cloudflare/workers-types'),
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
    peerDependencies: utilsPkg.data.peerDependencies,
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
  {
    composition: runtimeDeps,
  },
)
