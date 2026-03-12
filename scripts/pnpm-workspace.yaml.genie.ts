import { pnpmWorkspaceYaml } from '../genie/repo.ts'
import pkg from './package.json.genie.ts'

export default pnpmWorkspaceYaml.package({
  pkg,
  dedupePeerDependents: true,
  extraPackages: ['../docs/src/content/_assets/code'],
})
