export type LivestorePackageOwner = 'core' | 'effect-utils'
export type LivestorePackageProjection = 'core' | 'tooling'

export type LivestorePackageTopologyEntry = {
  readonly owner: LivestorePackageOwner
  readonly memberPath: `packages/@livestore/${string}`
  readonly public: boolean
  readonly projections: readonly LivestorePackageProjection[]
  readonly reason: string
}

/**
 * Machine-readable topology for packages this repository is responsible for
 * after the core/contrib split.
 *
 * This intentionally does not describe `livestore-contrib` packages. Contrib
 * owns its package and example manifest locally while importing shared core
 * generator helpers from this repository.
 */
export const livestorePackageTopology = {
  'adapter-cloudflare': {
    owner: 'core',
    memberPath: 'packages/@livestore/adapter-cloudflare',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Primary production adapter',
  },
  'adapter-web': {
    owner: 'core',
    memberPath: 'packages/@livestore/adapter-web',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Primary browser adapter',
  },
  common: {
    owner: 'core',
    memberPath: 'packages/@livestore/common',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Engine internals',
  },
  'common-cf': {
    owner: 'core',
    memberPath: 'packages/@livestore/common-cf',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Cloudflare engine internals',
  },
  'effect-playwright': {
    owner: 'effect-utils',
    memberPath: 'packages/@livestore/effect-playwright',
    public: true,
    projections: ['tooling'],
    reason: 'Shared browser-testing utility outside the final LiveStore package set',
  },
  'framework-toolkit': {
    owner: 'core',
    memberPath: 'packages/@livestore/framework-toolkit',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Shared primitive imported by React and contrib frameworks',
  },
  livestore: {
    owner: 'core',
    memberPath: 'packages/@livestore/livestore',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Engine root',
  },
  'peer-deps': {
    owner: 'core',
    memberPath: 'packages/@livestore/peer-deps',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Catalog management',
  },
  react: {
    owner: 'core',
    memberPath: 'packages/@livestore/react',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Primary framework integration',
  },
  'sqlite-wasm': {
    owner: 'core',
    memberPath: 'packages/@livestore/sqlite-wasm',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'SQLite browser surface',
  },
  'sync-cf': {
    owner: 'core',
    memberPath: 'packages/@livestore/sync-cf',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Primary sync provider',
  },
  utils: {
    owner: 'core',
    memberPath: 'packages/@livestore/utils',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Shared utility surface',
  },
  'utils-dev': {
    owner: 'core',
    memberPath: 'packages/@livestore/utils-dev',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Shared test infrastructure',
  },
  'wa-sqlite': {
    owner: 'core',
    memberPath: 'packages/@livestore/wa-sqlite',
    public: true,
    projections: ['core', 'tooling'],
    reason: 'Vendored SQLite',
  },
  webmesh: {
    owner: 'core',
    memberPath: 'packages/@livestore/webmesh',
    public: true,
    projections: ['core', 'tooling'],
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

export const packageJsonNameForPackageName = (name: LivestorePackageName) => `@livestore/${name}` as const

export const packageDirForPackageName = (name: LivestorePackageName) => livestorePackageTopology[name].memberPath

export const packageDescriptorForPackageName = (name: LivestorePackageName) => ({
  name: packageJsonNameForPackageName(name),
  dir: packageDirForPackageName(name),
})

export const workspaceCatalogForPackageNames = <const TPackageNames extends readonly string[]>(
  packageNames: TPackageNames,
) =>
  Object.fromEntries(packageNames.map((name) => [`@livestore/${name}`, 'workspace:*'])) as Record<
    `@livestore/${TPackageNames[number]}`,
    'workspace:*'
  >

export const workspaceCatalogForProjection = (projection: LivestorePackageProjection) =>
  workspaceCatalogForPackageNames(packageNamesForProjection(projection))

export const livestoreCorePackageNames = packageNamesForOwner('core')
export const livestoreEffectUtilsPackageNames = packageNamesForOwner('effect-utils')

/**
 * Packages still present in the current repository workspace before package
 * histories move to their final owning repositories.
 */
export const livestoreCurrentPackageNames = [
  'adapter-cloudflare',
  'adapter-expo',
  'adapter-node',
  'adapter-web',
  'cli',
  'common',
  'common-cf',
  'devtools-expo',
  'effect-playwright',
  'framework-toolkit',
  'graphql',
  'livestore',
  'peer-deps',
  'react',
  'solid',
  'sqlite-wasm',
  'svelte',
  'sync-cf',
  'sync-electric',
  'sync-s2',
  'utils',
  'utils-dev',
  'wa-sqlite',
  'webmesh',
] as const
