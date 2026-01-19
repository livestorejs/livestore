import { dotdotConfig } from '../@overeng/genie/src/runtime/dotdot-config/mod.ts'

/** dotdot member config for the livestore workspace */
export default dotdotConfig({
  exposes: {
    '@livestore/adapter-cloudflare': { path: 'packages/@livestore/adapter-cloudflare' },
    '@livestore/adapter-expo': { path: 'packages/@livestore/adapter-expo' },
    '@livestore/adapter-node': { path: 'packages/@livestore/adapter-node' },
    '@livestore/adapter-web': { path: 'packages/@livestore/adapter-web' },
    '@livestore/cli': { path: 'packages/@livestore/cli' },
    '@livestore/common': { path: 'packages/@livestore/common' },
    '@livestore/common-cf': { path: 'packages/@livestore/common-cf' },
    '@livestore/devtools-expo': { path: 'packages/@livestore/devtools-expo' },
    '@livestore/devtools-web-common': { path: 'packages/@livestore/devtools-web-common' },
    '@livestore/effect-playwright': { path: 'packages/@livestore/effect-playwright' },
    '@livestore/graphql': { path: 'packages/@livestore/graphql' },
    '@livestore/livestore': { path: 'packages/@livestore/livestore' },
    '@livestore/peer-deps': { path: 'packages/@livestore/peer-deps' },
    '@livestore/react': { path: 'packages/@livestore/react' },
    '@livestore/solid': { path: 'packages/@livestore/solid' },
    '@livestore/sqlite-wasm': { path: 'packages/@livestore/sqlite-wasm' },
    '@livestore/svelte': { path: 'packages/@livestore/svelte' },
    '@livestore/sync-cf': { path: 'packages/@livestore/sync-cf' },
    '@livestore/sync-electric': { path: 'packages/@livestore/sync-electric' },
    '@livestore/sync-s2': { path: 'packages/@livestore/sync-s2' },
    '@livestore/utils': { path: 'packages/@livestore/utils' },
    '@livestore/utils-dev': { path: 'packages/@livestore/utils-dev' },
    '@livestore/wa-sqlite': { path: 'packages/@livestore/wa-sqlite' },
    '@livestore/webmesh': { path: 'packages/@livestore/webmesh' },
  },
  deps: {
    'effect-utils': {
      url: 'git@github.com:overengineeringstudio/effect-utils.git',
    },
    /** Centralized beads issue tracking */
    'overeng-beads-public': {
      url: 'git@github.com:overengineeringstudio/overeng-beads-public.git',
    },
  },
})
