import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/adapter-node',
  exports: {
    '.': './src/index.ts',
    './devtools': './src/devtools/mod.ts',
    './worker': './src/make-leader-worker.ts',
  },
  dependencies: [
    '@livestore/common',
    '@livestore/devtools-vite',
    '@livestore/sqlite-wasm',
    '@livestore/utils',
    '@livestore/webmesh',
    '@opentelemetry/api',
    'vite',
  ],
  devDependencies: ['@rollup/plugin-commonjs', '@rollup/plugin-node-resolve', '@rollup/plugin-terser', 'rollup'],
  ...livestorePackageDefaults,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/index.js',
      './devtools': './dist/devtools/mod.js',
      './worker': './dist/make-leader-worker.js',
    },
  },
  scripts: {
    test: 'echo No tests yet',
  },
})
