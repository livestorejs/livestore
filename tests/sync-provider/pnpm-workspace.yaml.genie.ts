import { pnpmWorkspaceTests } from '../../genie/repo.ts'

export default pnpmWorkspaceTests([
  'adapter-cloudflare',
  'adapter-node',
  'common',
  'common-cf',
  'livestore',
  'sqlite-wasm',
  'sync-cf',
  'sync-electric',
  'sync-s2',
  'utils',
  'utils-dev',
])
