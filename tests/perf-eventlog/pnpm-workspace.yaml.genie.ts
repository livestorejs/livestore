import { pnpmWorkspaceReact } from '../../genie/repo.ts'

export default pnpmWorkspaceReact(
  '../packages/@livestore/adapter-web',
  '../packages/@livestore/common',
  '../packages/@livestore/livestore',
  '../packages/@livestore/react',
  '../packages/@livestore/sqlite-wasm',
  '../packages/@livestore/utils',
  '../packages/@livestore/utils-dev',
)
