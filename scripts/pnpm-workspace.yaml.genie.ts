import docsCodeSnippetsPkg from '../docs/src/content/_assets/code/package.json.genie.ts'
import { pnpmWorkspaceYaml } from '../genie/repo.ts'
import pkg from './package.json.genie.ts'

export default pnpmWorkspaceYaml.package({
  pkg,
  packages: [docsCodeSnippetsPkg],
  dedupePeerDependents: true,
})
