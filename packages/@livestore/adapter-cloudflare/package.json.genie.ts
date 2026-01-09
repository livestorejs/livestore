import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/adapter-cloudflare',
  sideEffects: ['./src/polyfill.ts', './dist/polyfill.js'],
  exports: {
    '.': './src/mod.ts',
    './polyfill': './src/polyfill.ts',
  },
  dependencies: [
    '@cloudflare/workers-types',
    '@livestore/common',
    '@livestore/common-cf',
    '@livestore/livestore',
    '@livestore/sqlite-wasm',
    '@livestore/sync-cf',
    '@livestore/utils',
  ],
  devDependencies: ['wrangler'],
  ...livestorePackageDefaults,
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
