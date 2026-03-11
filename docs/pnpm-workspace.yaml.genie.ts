import { pnpmWorkspaceYamlFromPackage } from '../genie/repo.ts'
import pkg from './package.json.genie.ts'

export default pnpmWorkspaceYamlFromPackage({
  pkg,
  extraPackages: ['./src/content/_assets/code'],
  dedupePeerDependents: true,
  publicHoistPattern: ['react', 'react-dom', 'react-reconciler'],
})
