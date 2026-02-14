import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-sync-provider',
  ...localPackageDefaults,
  exports: {
    './prepare-ci': './src/prepare-ci.ts',
    './registry': './src/providers/registry.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@cloudflare/workers-types',
      '@livestore/adapter-cloudflare',
      '@livestore/adapter-node',
      '@livestore/common',
      '@livestore/common-cf',
      '@livestore/livestore',
      '@livestore/sqlite-wasm',
      '@livestore/sync-cf',
      '@livestore/sync-electric',
      '@livestore/sync-s2',
      '@livestore/utils',
    ),
    postgres: '3.4.7',
  },
  devDependencies: {
    ...effectDevDeps('@livestore/devtools-vite', '@livestore/utils-dev', '@types/node', 'vitest'),
  },
  scripts: {
    test: 'vitest run',
    'test:watch': 'vitest',
  },
})
