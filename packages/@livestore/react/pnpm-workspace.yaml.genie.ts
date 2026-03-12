import { pnpmWorkspaceYaml } from '../../../genie/repo.ts'
import pkg from './package.json.genie.ts'

export default pnpmWorkspaceYaml.package({
  pkg,
  dedupePeerDependents: true,
  publicHoistPattern: ['react', 'react-dom', 'react-reconciler'],
})
