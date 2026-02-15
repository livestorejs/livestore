import { pnpmWorkspaceTests } from '../../genie/repo.ts'

export default pnpmWorkspaceTests([
  'adapter-node',
  'adapter-web',
  'common',
  'livestore',
  'sqlite-wasm',
  'utils',
  'utils-dev',
])
