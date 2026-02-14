import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import adapterNodePkg from '../adapter-node/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/cli',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
  },
  bin: {
    livestore: './src/bin.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@effect/ai',
      '@effect/ai-openai',
      '@effect/experimental',
      '@effect/opentelemetry',
      '@effect/platform',
      '@effect/rpc',
      '@livestore/adapter-node',
      '@livestore/common',
      '@livestore/livestore',
      '@livestore/peer-deps',
      '@livestore/utils',
      'effect',
    ),
  },
  devDependencies: { ...catalog.pick('@livestore/utils-dev', '@types/node', 'typescript', 'vitest') },
  peerDependencies: {
    ...utilsPkg.data.peerDependencies,
    ...catalog.peers('@livestore/devtools-vite'),
  },
  peerDependenciesMeta: adapterNodePkg.data.peerDependenciesMeta,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
    },
    bin: {
      livestore: './dist/bin.js',
    },
  },
  scripts: {
    build: 'tsc',
    dev: 'bun src/bin.ts',
  },
})
