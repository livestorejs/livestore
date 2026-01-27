import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/adapter-cloudflare',
  ...livestorePackageDefaults,
  sideEffects: ['./src/polyfill.ts', './dist/polyfill.js'],
  exports: {
    '.': './src/mod.ts',
    './polyfill': './src/polyfill.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@cloudflare/workers-types',
      '@livestore/common',
      '@livestore/common-cf',
      '@livestore/livestore',
      '@livestore/sqlite-wasm',
      '@livestore/sync-cf',
      '@livestore/utils',
    ),
  },
  devDependencies: {
    ...catalog.pick('wrangler'),
  },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './polyfill': './dist/polyfill.js',
    },
  },
  scripts: {
    test: 'echo No tests yet',
  },
})
