import { pnpmWorkspace } from '../../genie/repo.ts'

export default pnpmWorkspace(
  '../packages/@livestore/adapter-cloudflare',
  '../packages/@livestore/adapter-node',
  '../packages/@livestore/common',
  '../packages/@livestore/common-cf',
  '../packages/@livestore/livestore',
  '../packages/@livestore/sqlite-wasm',
  '../packages/@livestore/sync-cf',
  '../packages/@livestore/sync-electric',
  '../packages/@livestore/sync-s2',
  '../packages/@livestore/utils',
  '../packages/@livestore/utils-dev',
)
