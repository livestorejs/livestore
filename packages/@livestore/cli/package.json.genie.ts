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
import peerDepsPkg from '../peer-deps/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/cli'),
  dependencies: {
    workspace: [adapterNodePkg, commonPkg, livestorePkg, peerDepsPkg, utilsPkg],
    external: catalog.pick(
      '@effect/ai-openai',
      '@effect/opentelemetry',
      'effect',
    ),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick('@effect/platform-node', '@types/node', 'typescript', 'vitest'),
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
