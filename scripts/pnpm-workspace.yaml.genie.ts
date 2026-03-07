import { pnpmWorkspace } from '../genie/repo.ts'

// Scripts workspace - uses glob patterns to include all workspace packages
// This is the "root" workspace that includes all packages + docs + tests
// Note: examples have their own workspace (examples/pnpm-workspace.yaml) with
// linkWorkspacePackages:true to resolve fixed versions to local packages
export default pnpmWorkspace(
  '../packages/@livestore/*',
  '../packages/@local/*',
  '../docs',
  '../docs/src/content/_assets/code',
  '../tests/*',
)
