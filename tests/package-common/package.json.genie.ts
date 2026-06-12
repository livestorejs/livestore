import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../../genie/repo.ts'
import adapterWebPkg from '../../packages/@livestore/adapter-web/package.json.genie.ts'
import commonPkg from '../../packages/@livestore/common/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import sqliteWasmPkg from '../../packages/@livestore/sqlite-wasm/package.json.genie.ts'
import utilsDevPkg from '../../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('tests/package-common'),
  dependencies: {
    workspace: [adapterWebPkg, commonPkg, livestorePkg, sqliteWasmPkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: effectDevDeps('@livestore/devtools-vite', '@types/node', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@local/tests-package-common',
    ...localPackageDefaults,
    scripts: {
      test: 'vitest run',
      'test:watch': 'vitest',
    },
  },
  runtimeDeps,
)
