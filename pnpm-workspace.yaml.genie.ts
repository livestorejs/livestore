import { examplesWorkspaceData } from './examples/pnpm-workspace.yaml.genie.ts'
import { pnpmWorkspaceYaml } from './genie/repo.ts'
import { rootWorkspaceMemberPaths } from './package.json.genie.ts'

export default pnpmWorkspaceYaml.manual({
  packages: rootWorkspaceMemberPaths,
  ...examplesWorkspaceData,
})
