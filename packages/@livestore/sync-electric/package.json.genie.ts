import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/sync-electric',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/index.ts',
  },
  dependencies: { ...catalog.pick('@livestore/common', '@livestore/utils') },
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
