import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/sync-electric',
  exports: {
    '.': './src/index.ts',
  },
  dependencies: ['@livestore/common', '@livestore/utils'],
  ...livestorePackageDefaults,
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
})
