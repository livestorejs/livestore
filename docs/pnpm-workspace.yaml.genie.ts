import { pnpmWorkspaceYaml } from '../genie/repo.ts'
import pkg from './package.json.genie.ts'
import codeSnippetsPkg from './src/content/_assets/code/package.json.genie.ts'

export default pnpmWorkspaceYaml.package({
  pkg,
  packages: [codeSnippetsPkg],
  dedupePeerDependents: true,
  publicHoistPattern: ['react', 'react-dom', 'react-reconciler'],
})
