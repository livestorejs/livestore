import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import commonCfPkg from '../common-cf/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'
import waSqlitePkg from '../wa-sqlite/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, commonCfPkg, utilsPkg, waSqlitePkg],
    external: catalog.pick('@cloudflare/workers-types'),
  },
  devDependencies: {
    external: catalog.pick('@types/chrome', '@types/node', '@types/wicg-file-system-access', 'vitest', 'wrangler'),
  },
})

export default packageJson(
  {
    name: '@livestore/sqlite-wasm',
    ...livestorePackageDefaults,
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
    peerDependencies: utilsPkg.data.peerDependencies,
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
  },
  runtimeDeps,
)
