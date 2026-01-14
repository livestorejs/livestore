import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/webmesh',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: { ...catalog.pick('@livestore/utils') },
  devDependencies: { ...catalog.pick('@livestore/utils-dev', 'vitest') },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
    },
  },
  scripts: {
    test: 'vitest',
  },
})
