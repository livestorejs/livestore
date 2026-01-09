import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/sqlite-wasm',
  exports: {
    '.': './src/index.ts',
    './load-wasm': {
      workerd: './src/load-wasm/mod.workerd.ts',
      browser: './src/load-wasm/mod.browser.ts',
      worker: './src/load-wasm/mod.browser.ts',
      node: './src/load-wasm/mod.node.ts',
      default: './src/load-wasm/mod.browser.ts',
    },
    './node': './src/node/mod.ts',
    './cf': './src/cf/mod.ts',
    './browser': './src/browser/mod.ts',
  },
  dependencies: [
    '@cloudflare/workers-types',
    '@livestore/common',
    '@livestore/common-cf',
    '@livestore/utils',
    '@livestore/wa-sqlite',
  ],
  devDependencies: ['@types/chrome', '@types/node', '@types/wicg-file-system-access', 'vitest', 'wrangler'],
  ...livestorePackageDefaults,
  publishConfig: {
    access: 'public',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
      './load-wasm': {
        types: './dist/load-wasm/mod.browser.d.ts',
        workerd: './dist/load-wasm/mod.workerd.js',
        browser: './dist/load-wasm/mod.browser.js',
        worker: './dist/load-wasm/mod.browser.js',
        node: './dist/load-wasm/mod.node.js',
        default: './dist/load-wasm/mod.browser.js',
      },
      './node': {
        types: './dist/node/mod.d.ts',
        default: './dist/node/mod.js',
      },
      './cf': {
        types: './dist/cf/mod.d.ts',
        default: './dist/cf/mod.js',
      },
      './browser': {
        types: './dist/browser/mod.d.ts',
        default: './dist/browser/mod.js',
      },
    },
  },
  scripts: {
    test: 'vitest',
    'test:ui': 'vitest --ui',
    'test:watch': 'vitest --watch',
  },
})
