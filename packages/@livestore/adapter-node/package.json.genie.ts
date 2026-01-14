import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/adapter-node',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/index.ts',
    './devtools': './src/devtools/mod.ts',
    './worker': './src/make-leader-worker.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/common',
      '@livestore/devtools-vite',
      '@livestore/sqlite-wasm',
      '@livestore/utils',
      '@livestore/webmesh',
      '@opentelemetry/api',
      'vite',
    ),
  },
  devDependencies: {
    ...catalog.pick('@rollup/plugin-commonjs', '@rollup/plugin-node-resolve', '@rollup/plugin-terser', 'rollup'),
  },
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
