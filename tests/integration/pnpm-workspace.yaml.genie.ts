import { pnpmWorkspaceReact } from '../../genie/repo.ts'

export default pnpmWorkspaceReact(
  '../packages/@livestore/adapter-cloudflare',
  '../packages/@livestore/adapter-node',
  '../packages/@livestore/adapter-web',
  '../packages/@livestore/common',
  '../packages/@livestore/effect-playwright',
  '../packages/@livestore/livestore',
  '../packages/@livestore/react',
  '../packages/@livestore/sync-cf',
  '../packages/@livestore/utils',
  '../packages/@livestore/utils-dev',
  '../packages/@local/shared',
)
