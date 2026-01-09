import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/webmesh',
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: ['@livestore/utils'],
  devDependencies: ['@livestore/utils-dev', 'vitest'],
  ...livestorePackageDefaults,
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
