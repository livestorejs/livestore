import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import adapterNodePkg from '../adapter-node/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import peerDepsPkg from '../peer-deps/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [adapterNodePkg, commonPkg, livestorePkg, peerDepsPkg, utilsPkg],
    external: catalog.pick(
      '@effect/ai',
      '@effect/ai-openai',
      '@effect/experimental',
      '@effect/opentelemetry',
      '@effect/platform',
      '@effect/rpc',
      'effect',
    ),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick('@types/node', 'typescript', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@livestore/cli',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
    },
    bin: {
      livestore: './src/bin.ts',
    },
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
  },
  {
    composition: runtimeDeps,
  },
)
