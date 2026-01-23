import { catalog, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-package-common',
  ...localPackageDefaults,
  exports: {
    './todomvc-fixture': './src/todomvc-fixture.ts',
  },
  dependencies: {
    '@livestore/adapter-node': 'file:../../packages/@livestore/adapter-node',
    '@livestore/adapter-web': 'file:../../packages/@livestore/adapter-web',
    '@livestore/common': 'file:../../packages/@livestore/common',
    '@livestore/livestore': 'file:../../packages/@livestore/livestore',
    '@livestore/sqlite-wasm': 'file:../../packages/@livestore/sqlite-wasm',
    '@livestore/utils': 'file:../../packages/@livestore/utils',
    ...catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    '@livestore/utils-dev': 'file:../../packages/@livestore/utils-dev',
    ...catalog.pick('vitest'),
  },
})
