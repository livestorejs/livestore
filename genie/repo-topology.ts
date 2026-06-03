export type LivestorePackageOwner = 'core' | 'contrib' | 'effect-utils'
export type LivestorePackageProjection = 'root' | 'core' | 'tooling' | 'contrib'
export type LivestoreReleaseGroup = 'livestore-fixed'

export type LivestorePackageTopologyEntry = {
  readonly owner: LivestorePackageOwner
  readonly memberPath: `packages/@livestore/${string}`
  readonly public: boolean
  readonly releaseGroup: LivestoreReleaseGroup | null
  readonly changesetsIgnore?: true
  readonly projections: readonly LivestorePackageProjection[]
  readonly reason: string
}

/**
 * Machine-readable LiveStore repository topology.
 *
 * This is the generator-facing source of truth for package/example ownership
 * across the core and contrib repositories. Human-facing architecture docs
 * describe the rationale; generators should import this file instead of
 * restating ownership lists.
 *
 * Ownership is not projection membership: a package can be owned by one repo,
 * included in another composed install projection, and participate in release
 * groups independently.
 */
export const livestorePackageTopology = {
  'adapter-cloudflare': {
    owner: 'core',
    memberPath: 'packages/@livestore/adapter-cloudflare',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Primary production adapter',
  },
  'adapter-expo': {
    owner: 'contrib',
    memberPath: 'packages/@livestore/adapter-expo',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Expo platform adapter',
  },
  'adapter-node': {
    owner: 'contrib',
    memberPath: 'packages/@livestore/adapter-node',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Node platform adapter',
  },
  'adapter-web': {
    owner: 'core',
    memberPath: 'packages/@livestore/adapter-web',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Primary browser adapter',
  },
  cli: {
    owner: 'contrib',
    memberPath: 'packages/@livestore/cli',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Scaffolding and MCP server',
  },
  common: {
    owner: 'core',
    memberPath: 'packages/@livestore/common',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Engine internals',
  },
  'common-cf': {
    owner: 'core',
    memberPath: 'packages/@livestore/common-cf',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Cloudflare engine internals',
  },
  'devtools-expo': {
    owner: 'contrib',
    memberPath: 'packages/@livestore/devtools-expo',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Expo devtools surface',
  },
  'devtools-web-common': {
    owner: 'contrib',
    memberPath: 'packages/@livestore/devtools-web-common',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Shared contrib devtools surface',
  },
  'effect-playwright': {
    owner: 'effect-utils',
    memberPath: 'packages/@livestore/effect-playwright',
    public: true,
    releaseGroup: null,
    changesetsIgnore: true,
    projections: ['root', 'tooling'],
    reason: 'Shared browser-testing utility outside the final LiveStore package set',
  },
  'framework-toolkit': {
    owner: 'core',
    memberPath: 'packages/@livestore/framework-toolkit',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Shared primitive imported by React and contrib frameworks',
  },
  graphql: {
    owner: 'contrib',
    memberPath: 'packages/@livestore/graphql',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Optional integration',
  },
  livestore: {
    owner: 'core',
    memberPath: 'packages/@livestore/livestore',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Engine root',
  },
  'peer-deps': {
    owner: 'core',
    memberPath: 'packages/@livestore/peer-deps',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Catalog management',
  },
  react: {
    owner: 'core',
    memberPath: 'packages/@livestore/react',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Primary framework integration',
  },
  solid: {
    owner: 'contrib',
    memberPath: 'packages/@livestore/solid',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Framework integration',
  },
  'sqlite-wasm': {
    owner: 'core',
    memberPath: 'packages/@livestore/sqlite-wasm',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'SQLite browser surface',
  },
  svelte: {
    owner: 'contrib',
    memberPath: 'packages/@livestore/svelte',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Framework integration',
  },
  'sync-cf': {
    owner: 'core',
    memberPath: 'packages/@livestore/sync-cf',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Primary sync provider',
  },
  'sync-electric': {
    owner: 'contrib',
    memberPath: 'packages/@livestore/sync-electric',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Additional sync provider',
  },
  'sync-s2': {
    owner: 'contrib',
    memberPath: 'packages/@livestore/sync-s2',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'contrib'],
    reason: 'Additional sync provider',
  },
  utils: {
    owner: 'core',
    memberPath: 'packages/@livestore/utils',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Shared utility surface',
  },
  'utils-dev': {
    owner: 'core',
    memberPath: 'packages/@livestore/utils-dev',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Shared test infrastructure',
  },
  'wa-sqlite': {
    owner: 'core',
    memberPath: 'packages/@livestore/wa-sqlite',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Vendored SQLite',
  },
  webmesh: {
    owner: 'core',
    memberPath: 'packages/@livestore/webmesh',
    public: true,
    releaseGroup: 'livestore-fixed',
    projections: ['root', 'core', 'tooling'],
    reason: 'Cross-worker mesh primitive',
  },
} as const satisfies Record<string, LivestorePackageTopologyEntry>

export type LivestorePackageName = keyof typeof livestorePackageTopology

export const packageNamesForOwner = <Owner extends LivestorePackageOwner>(owner: Owner) =>
  Object.entries(livestorePackageTopology)
    .filter(([, info]) => info.owner === owner)
    .map(([name]) => name)
    .toSorted() as Extract<
    LivestorePackageName,
    {
      [Name in LivestorePackageName]: (typeof livestorePackageTopology)[Name]['owner'] extends Owner ? Name : never
    }[LivestorePackageName]
  >[]

export const packageNamesForProjection = (projection: LivestorePackageProjection) =>
  Object.entries(livestorePackageTopology)
    .filter(([, info]) => info.projections.includes(projection))
    .map(([name]) => name)
    .toSorted() as LivestorePackageName[]

export const memberPathsForProjection = (projection: LivestorePackageProjection) =>
  packageNamesForProjection(projection).map((name) => livestorePackageTopology[name].memberPath)

export const materializedMemberPathsForProjection = (projection: LivestorePackageProjection, prefix: string) =>
  memberPathsForProjection(projection).map((memberPath) => `${prefix}/${memberPath}`)

export const releaseGroupPackageNames = (releaseGroup: LivestoreReleaseGroup) =>
  Object.entries(livestorePackageTopology)
    .filter(([, info]) => info.releaseGroup === releaseGroup)
    .map(([name]) => name)
    .toSorted() as LivestorePackageName[]

export const changesetsIgnoredPackageNames = Object.entries(livestorePackageTopology)
  .filter(([, info]) => info.changesetsIgnore === true)
  .map(([name]) => name)
  .toSorted() as LivestorePackageName[]

export const packageJsonNameForPackageName = (name: LivestorePackageName) => `@livestore/${name}` as const

export const packageDirForPackageName = (name: LivestorePackageName) => livestorePackageTopology[name].memberPath

export const packageDescriptorForPackageName = (name: LivestorePackageName) => ({
  name: packageJsonNameForPackageName(name),
  dir: packageDirForPackageName(name),
})

export const releaseGroupPackageJsonNames = (releaseGroup: LivestoreReleaseGroup) =>
  releaseGroupPackageNames(releaseGroup).map(packageJsonNameForPackageName)

export const releaseGroupPackageDescriptors = (releaseGroup: LivestoreReleaseGroup) =>
  releaseGroupPackageNames(releaseGroup).map(packageDescriptorForPackageName)

export const changesetsIgnoredPackageJsonNames = changesetsIgnoredPackageNames.map(packageJsonNameForPackageName)

export const publishableLivestorePackageDescriptors = releaseGroupPackageDescriptors('livestore-fixed')
export const publishableLivestorePackageJsonNames = releaseGroupPackageJsonNames('livestore-fixed')

export const workspaceCatalogForProjection = (projection: LivestorePackageProjection) =>
  Object.fromEntries(packageNamesForProjection(projection).map((name) => [`@livestore/${name}`, 'workspace:*']))

export const livestoreCorePackageNames = packageNamesForOwner('core')
export const livestoreContribPackageNames = packageNamesForOwner('contrib')
export const livestoreEffectUtilsPackageNames = packageNamesForOwner('effect-utils')
export const livestoreOwnedPackageNames = [...livestoreCorePackageNames, ...livestoreContribPackageNames] as const

/**
 * Packages still present in the current monorepo workspace before the
 * externalized effect-utils package and contrib-owned package histories move.
 */
export const livestoreCurrentPackageNames = [
  ...livestoreOwnedPackageNames,
  ...livestoreEffectUtilsPackageNames,
] as const

export const livestoreContribExampleMembers = [
  'examples/cf-chat',
  'examples/cf-chat-solid',
  'examples/expo-linearlite',
  'examples/expo-todomvc-sync-cf',
  'examples/node-effect-cli',
  'examples/node-todomvc-sync-cf',
  'examples/web-multi-store',
  'examples/web-todomvc-solid',
  'examples/web-todomvc-svelte',
  'examples/web-todomvc-sync-electric',
  'examples/web-todomvc-sync-s2',
] as const
