export type LivestorePackageOwner = 'core' | 'effect-utils'

export type LivestorePackageTopologyEntry = {
  readonly owner: LivestorePackageOwner
  readonly memberPath: `packages/@livestore/${string}`
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
    reason: 'Primary production adapter',
  },
  'adapter-web': {
    owner: 'core',
    memberPath: 'packages/@livestore/adapter-web',
    reason: 'Primary browser adapter',
  },
  common: {
    owner: 'core',
    memberPath: 'packages/@livestore/common',
    reason: 'Engine internals',
  },
  'common-cf': {
    owner: 'core',
    memberPath: 'packages/@livestore/common-cf',
    reason: 'Cloudflare engine internals',
  },
  'effect-playwright': {
    owner: 'effect-utils',
    memberPath: 'packages/@livestore/effect-playwright',
    reason: 'Shared browser-testing utility outside the final LiveStore package set',
  },
  'framework-toolkit': {
    owner: 'core',
    memberPath: 'packages/@livestore/framework-toolkit',
    reason: 'Shared primitive imported by React and contrib frameworks',
  },
  livestore: {
    owner: 'core',
    memberPath: 'packages/@livestore/livestore',
    reason: 'Engine root',
  },
  'peer-deps': {
    owner: 'core',
    memberPath: 'packages/@livestore/peer-deps',
    reason: 'Catalog management',
  },
  react: {
    owner: 'core',
    memberPath: 'packages/@livestore/react',
    reason: 'Primary framework integration',
  },
  'sqlite-wasm': {
    owner: 'core',
    memberPath: 'packages/@livestore/sqlite-wasm',
    reason: 'SQLite browser surface',
  },
  'sync-cf': {
    owner: 'core',
    memberPath: 'packages/@livestore/sync-cf',
    reason: 'Primary sync provider',
  },
  utils: {
    owner: 'core',
    memberPath: 'packages/@livestore/utils',
    reason: 'Shared utility surface',
  },
  'utils-dev': {
    owner: 'core',
    memberPath: 'packages/@livestore/utils-dev',
    reason: 'Shared test infrastructure',
  },
  'wa-sqlite': {
    owner: 'core',
    memberPath: 'packages/@livestore/wa-sqlite',
    reason: 'Vendored SQLite',
  },
  webmesh: {
    owner: 'core',
    memberPath: 'packages/@livestore/webmesh',
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

export const livestoreCorePackageNames = packageNamesForOwner('core')
export const livestoreEffectUtilsPackageNames = packageNamesForOwner('effect-utils')

/**
 * Packages still present in the current repository workspace before package
 * histories move to their final owning repositories.
 */
export const livestoreCurrentPackageNames = Object.keys(livestorePackageTopology).toSorted() as LivestorePackageName[]
