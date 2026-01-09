import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/devtools-web-common',
  exports: {
    './web-channel': './src/web-channel/index.ts',
    './worker': './src/worker/mod.ts',
  },
  dependencies: ['@livestore/common', '@livestore/utils', '@livestore/webmesh'],
  ...livestorePackageDefaults,
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
})
