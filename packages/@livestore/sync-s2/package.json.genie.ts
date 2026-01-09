import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/sync-s2',
  exports: {
    '.': './src/mod.ts',
    './s2-proxy-helpers': './src/s2-proxy-helpers.ts',
  },
  dependencies: ['@livestore/common', '@livestore/livestore', '@livestore/utils'],
  ...livestorePackageDefaults,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './s2-proxy-helpers': './dist/s2-proxy-helpers.js',
    },
  },
  scripts: {
    build: '',
    test: "echo 'No tests yet'",
  },
})
