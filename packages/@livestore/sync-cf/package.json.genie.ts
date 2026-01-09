import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/sync-cf',
  exports: {
    './client': './src/client/mod.ts',
    './common': './src/common/mod.ts',
    './cf-worker': './src/cf-worker/mod.ts',
  },
  dependencies: ['@cloudflare/workers-types', '@livestore/common', '@livestore/common-cf', '@livestore/utils'],
  ...livestorePackageDefaults,
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
