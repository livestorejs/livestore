import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/devtools-web-common',
  ...livestorePackageDefaults,
  exports: {
    './web-channel': './src/web-channel/index.ts',
    './worker': './src/worker/mod.ts',
  },
  dependencies: { ...catalog.pick('@livestore/common', '@livestore/utils', '@livestore/webmesh') },
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
