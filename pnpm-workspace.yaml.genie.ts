import { catalog, workspacePackages } from './genie/repo.ts'
// Relative import - works when running from overtone root via submodules
import { pnpmWorkspace } from '../effect-utils/packages/@overeng/genie/src/lib/mod.ts'

export default pnpmWorkspace({
  packages: workspacePackages,
  catalog,
})
