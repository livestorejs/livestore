import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'
import adapterCloudflarePkg from '../../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import adapterNodePkg from '../../packages/@livestore/adapter-node/package.json.genie.ts'
import commonCfPkg from '../../packages/@livestore/common-cf/package.json.genie.ts'
import commonPkg from '../../packages/@livestore/common/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import sqliteWasmPkg from '../../packages/@livestore/sqlite-wasm/package.json.genie.ts'
import syncCfPkg from '../../packages/@livestore/sync-cf/package.json.genie.ts'
import syncElectricPkg from '../../packages/@livestore/sync-electric/package.json.genie.ts'
import syncS2Pkg from '../../packages/@livestore/sync-s2/package.json.genie.ts'
import utilsDevPkg from '../../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [
      adapterCloudflarePkg,
      adapterNodePkg,
      commonPkg,
      commonCfPkg,
      livestorePkg,
      sqliteWasmPkg,
      syncCfPkg,
      syncElectricPkg,
      syncS2Pkg,
      utilsPkg,
    ],
    external: {
      ...catalog.pick('@cloudflare/workers-types'),
      postgres: '3.4.7',
    },
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: effectDevDeps('@livestore/devtools-vite', '@types/node', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@local/tests-sync-provider',
    ...localPackageDefaults,
    exports: {
      './prepare-ci': './src/prepare-ci.ts',
      './registry': './src/providers/registry.ts',
    },
    scripts: {
      test: 'vitest run',
      'test:watch': 'vitest',
    },
  },
  runtimeDeps,
)
