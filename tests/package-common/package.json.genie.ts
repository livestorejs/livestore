import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'
import adapterNodePkg from '../../packages/@livestore/adapter-node/package.json.genie.ts'
import adapterWebPkg from '../../packages/@livestore/adapter-web/package.json.genie.ts'
import commonPkg from '../../packages/@livestore/common/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import sqliteWasmPkg from '../../packages/@livestore/sqlite-wasm/package.json.genie.ts'
import utilsDevPkg from '../../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [adapterNodePkg, adapterWebPkg, commonPkg, livestorePkg, sqliteWasmPkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: effectDevDeps('@livestore/devtools-vite', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@local/tests-package-common',
    ...localPackageDefaults,
    exports: {
      './todomvc-fixture': './src/todomvc-fixture.ts',
    },
  },
  runtimeDeps,
)
