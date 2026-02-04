import { pnpmWorkspace } from '../genie/repo.ts'

// Scripts is at repo root level - explicit workspace dependencies only
export default pnpmWorkspace(
  // @livestore packages
  '../packages/@livestore/common',
  '../packages/@livestore/utils',
  '../packages/@livestore/utils-dev',
  // @local packages
  '../packages/@local/astro-tldraw',
  '../packages/@local/astro-twoslash-code',
  // Root-level packages
  '../docs',
  '../tests/integration',
  '../tests/sync-provider',
)
