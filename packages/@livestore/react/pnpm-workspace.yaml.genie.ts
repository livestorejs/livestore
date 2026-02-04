import { pnpmWorkspaceReact } from '../../../genie/repo.ts'

// React package - needs React hoisting for single instance
export default pnpmWorkspaceReact(
  '../common',
  '../framework-toolkit',
  '../livestore',
  '../utils',
  '../adapter-web',
  '../utils-dev',
)
