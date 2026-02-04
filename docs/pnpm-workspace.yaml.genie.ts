import { pnpmWorkspaceReact } from '../genie/repo.ts'

// Docs package - uses React, needs paths relative to docs/ directory
export default pnpmWorkspaceReact(
  // @livestore packages
  '../packages/@livestore/adapter-cloudflare',
  '../packages/@livestore/adapter-expo',
  '../packages/@livestore/adapter-node',
  '../packages/@livestore/adapter-web',
  '../packages/@livestore/common',
  '../packages/@livestore/livestore',
  '../packages/@livestore/react',
  '../packages/@livestore/solid',
  '../packages/@livestore/sync-cf',
  '../packages/@livestore/sync-s2',
  '../packages/@livestore/utils',
  // @local packages
  '../packages/@local/astro-tldraw',
  '../packages/@local/astro-twoslash-code',
  '../packages/@local/shared',
)
