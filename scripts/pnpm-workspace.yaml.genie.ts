import { pnpmWorkspace } from '../genie/repo.ts'

// Scripts workspace - uses glob patterns to include all workspace packages
// This is the "root" workspace that includes all packages + docs + tests
export default pnpmWorkspace(
  '../packages/@livestore/*',
  '../packages/@local/*',
  '../docs',
  '../tests/*',
  '../examples/*',
)
