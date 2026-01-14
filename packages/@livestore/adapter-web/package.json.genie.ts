import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/adapter-web',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/index.ts',
    './worker': './src/web-worker/leader-worker/make-leader-worker.ts',
    './worker-vite-dev-polyfill': './src/web-worker/vite-dev-polyfill.ts',
    './shared-worker': './src/web-worker/shared-worker/make-shared-worker.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/common',
      '@livestore/devtools-web-common',
      '@livestore/sqlite-wasm',
      '@livestore/utils',
      '@livestore/webmesh',
      '@opentelemetry/api',
    ),
  },
  devDependencies: {
    ...catalog.pick('@types/chrome', '@types/wicg-file-system-access', 'vitest'),
  },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/index.js',
      './worker': './dist/web-worker/leader-worker/make-leader-worker.js',
      './worker-vite-dev-polyfill': './dist/web-worker/vite-dev-polyfill.js',
      './shared-worker': './dist/web-worker/shared-worker/make-shared-worker.js',
    },
  },
  scripts: {
    test: 'echo No tests yet',
  },
})
