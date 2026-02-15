import { pnpmWorkspaceTestsReact } from '../../genie/repo.ts'

export default pnpmWorkspaceTestsReact(
  [
    'adapter-cloudflare',
    'adapter-node',
    'adapter-web',
    'common',
    'common-cf',
    'effect-playwright',
    'livestore',
    'react',
    'sync-cf',
    'utils',
    'utils-dev',
  ],
  ['../../packages/@local/shared'],
)
