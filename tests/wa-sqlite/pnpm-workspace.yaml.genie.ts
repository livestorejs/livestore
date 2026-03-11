import { pnpmWorkspaceYamlFromPackage } from '../../genie/repo.ts'
import pkg from './package.json.genie.ts'

export default pnpmWorkspaceYamlFromPackage({
  pkg,
  dedupePeerDependents: true,
})
