import { catalog, localPackageDefaults, packageJson, workspaceMember } from '../../genie/repo.ts'
import adapterCfPkg from '../../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import commonPkg from '../../packages/@livestore/common/package.json.genie.ts'
import commonCfPkg from '../../packages/@livestore/common-cf/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import syncCfPkg from '../../packages/@livestore/sync-cf/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'

/**
 * cf-bench is a standalone workspace (own pnpm-workspace.yaml) used for
 * manual benchmarking of the CF adapter. It uses workspace:* deps to build
 * against local adapter changes.
 */
const composition = catalog.compose({
  workspace: workspaceMember('tests/cf-bench'),
  dependencies: {
    workspace: [adapterCfPkg, commonPkg, commonCfPkg, livestorePkg, syncCfPkg, utilsPkg],
    external: catalog.pick('@cloudflare/workers-types'),
  },
  devDependencies: {
    external: catalog.pick('wrangler'),
  },
})

export default packageJson(
  {
    name: '@local/cf-bench',
    ...localPackageDefaults,
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      bench: './run-bench.sh',
    },
  },
  composition,
)
