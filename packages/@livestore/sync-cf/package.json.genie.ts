import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/sync-cf',
  ...livestorePackageDefaults,
  exports: {
    './client': './src/client/mod.ts',
    './common': './src/common/mod.ts',
    './cf-worker': './src/cf-worker/mod.ts',
  },
  dependencies: {
    ...catalog.pick('@cloudflare/workers-types', '@livestore/common', '@livestore/common-cf', '@livestore/utils'),
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
})
