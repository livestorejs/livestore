import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/framework-toolkit',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
    './testing': './src/testing.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/common',
      '@livestore/livestore',
      '@livestore/utils',
      '@opentelemetry/api',
    ),
  },
  devDependencies: {
    ...catalog.pick('@livestore/utils-dev', 'typescript'),
  },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './testing': './dist/testing.js',
    },
  },
  scripts: {
    build: 'tsc',
  },
})
