import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-package-common',
  ...localPackageDefaults,
  exports: {
    './todomvc-fixture': './src/todomvc-fixture.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/adapter-node',
      '@livestore/adapter-web',
      '@livestore/common',
      '@livestore/livestore',
      '@livestore/sqlite-wasm',
      '@livestore/utils',
      '@opentelemetry/api',
    ),
  },
  devDependencies: {
    ...effectDevDeps('@livestore/devtools-vite', '@livestore/utils-dev', 'vitest'),
  },
})
