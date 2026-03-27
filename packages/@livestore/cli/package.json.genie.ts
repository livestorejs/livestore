import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  repoPnpmOnlyBuiltDependencies,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import adapterNodePkg from '../adapter-node/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/cli'),
  dependencies: {
    workspace: [adapterNodePkg, commonPkg, livestorePkg, utilsPkg],
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
  peerDependencies: {
    external: {
      ...getUtilsPeerDeps(),
    },
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
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
      },
      bin: {
        livestore: './dist/bin.js',
      },
    },
    pnpm: {
      onlyBuiltDependencies: repoPnpmOnlyBuiltDependencies,
    },
    scripts: {
      build: 'tsc',
      dev: 'bun src/bin.ts',
    },
  },
  runtimeDeps,
)
