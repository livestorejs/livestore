import { pnpmWorkspace } from '../../genie/repo.ts'

export default pnpmWorkspace(
  '../packages/@livestore/adapter-node',
  '../packages/@livestore/adapter-web',
  '../packages/@livestore/common',
  '../packages/@livestore/livestore',
  '../packages/@livestore/sqlite-wasm',
  '../packages/@livestore/utils',
  '../packages/@livestore/utils-dev',
)
