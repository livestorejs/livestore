import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/utils',
  ...livestorePackageDefaults,
  sideEffects: ['./src/global.ts', './dist/global.js'],
  exports: {
    '.': './src/mod.ts',
    './browser': './src/browser/mod.ts',
    './cuid': {
      browser: './src/cuid/cuid.browser.ts',
      'react-native': './src/cuid/cuid.browser.ts',
      default: './src/cuid/cuid.node.ts',
    },
    './nanoid': './src/nanoid/index.ts',
    './effect': './src/effect/mod.ts',
    './effect/browser': './src/browser/mod.ts',
    './node': './src/node/mod.ts',
    './bun': './src/bun/mod.ts',
  },
  dependencies: {
    ...catalog.pick('@effect/platform-node', '@standard-schema/spec', 'nanoid', 'pretty-bytes', 'qrcode-generator'),
  },
  devDependencies: {
    // Include peer deps for local development + dev-only deps
    ...catalog.pick(
      ...utilsEffectPeerDeps,
      '@effect/vitest',
      '@effect/workflow',
      '@types/bun',
      '@types/jsdom',
      '@types/node',
      '@types/web',
      'jsdom',
      'vitest',
    ),
  },
  // Use catalog.peers() for consistent versioning with ^ prefix
  peerDependencies: getUtilsPeerDeps(),
  publishConfig: {
    access: 'public',
    exports: {
      '.': {
        types: './dist/mod.d.ts',
        default: './dist/mod.js',
      },
      './browser': {
        types: './dist/browser/mod.d.ts',
        default: './dist/browser/mod.js',
      },
      './cuid': {
        types: './dist/cuid/cuid.node.d.ts',
        browser: './dist/cuid/cuid.browser.js',
        'react-native': './dist/cuid/cuid.browser.js',
        default: './dist/cuid/cuid.node.js',
      },
      './nanoid': {
        types: './dist/nanoid/index.d.ts',
        default: './dist/nanoid/index.js',
      },
      './effect': {
        types: './dist/effect/mod.d.ts',
        default: './dist/effect/mod.js',
      },
      './effect/browser': {
        types: './dist/browser/mod.d.ts',
        default: './dist/browser/mod.js',
      },
      './node': {
        types: './dist/node/mod.d.ts',
        default: './dist/node/mod.js',
      },
      './bun': {
        types: './dist/bun/mod.d.ts',
        default: './dist/bun/mod.js',
      },
    },
  },
  'react-native': './dist/index.js',
  scripts: {
    test: 'vitest',
  },
})
