import { pnpmWorkspaceYaml } from './genie/repo.ts'
import { rootWorkspaceMemberPaths } from './package.json.genie.ts'

const examplesWorkspaceSettings = {
  linkWorkspacePackages: true,
  dedupePeerDependents: true,
  overrides: {
    '@tanstack/router-core': '1.139.14',
    '@tanstack/history': '1.139.0',
    '@tanstack/react-router': '1.139.14',
    '@tanstack/react-start': '1.139.14',
    '@tanstack/router-devtools': '1.139.14',
    '@tanstack/router-devtools-core': '1.139.14',
    '@tanstack/react-router-devtools': '1.139.14',
    '@tanstack/router-plugin': '1.139.14',
    '@tanstack/start-plugin-core': '1.139.14',
    '@tanstack/start-server-core': '1.139.14',
    '@tanstack/start-client-core': '1.139.14',
  },
} as const

/** Uses `manual(...)` because `examples/*` must be workspace members for local dev linking
 * but are intentionally not genie-managed (standalone, copyable). `root(...)` can't derive non-genie-managed members. */
export default pnpmWorkspaceYaml.manual({
  packages: rootWorkspaceMemberPaths,
  ...examplesWorkspaceSettings,
})
