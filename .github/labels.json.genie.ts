import {
  commonLabels,
  deprecatedDefaults,
  githubLabels,
  type LabelDef,
  legacyMigrations,
  mqDeprecated,
} from '#mr/effect-utils/genie/external.ts'

/**
 * Core-local `area:*` / domain labels for livestore. The cross-cutting axes
 * (`type:*`, `state:*`, `origin:*`, and the shared `area:*` baseline) come from
 * `commonLabels`; the labels below are livestore's own product taxonomy, which
 * is finer-grained than the shared `area:*` baseline (e.g. `adapter:web` vs
 * `adapter:expo`) and is preserved rather than flattened.
 *
 * Colors are kept at their existing live values so adoption does not recolor the
 * established public taxonomy. Community labels (`help wanted`, `good first
 * issue`, `needs-sponsor`) are intentionally NOT enumerated here so they survive
 * untouched (the reconciler only creates/patches listed labels and deletes
 * `deprecated` ones).
 */
const livestoreAdapterLabels: readonly LabelDef[] = [
  { name: 'adapter:web', color: 'E5760F', description: 'Web adapter (browser / worker) · Set: manual' },
  { name: 'adapter:expo', color: '0E4046', description: 'Expo / React Native adapter · Set: manual' },
  { name: 'adapter:node', color: '417e38', description: 'Node adapter · Set: manual' },
  { name: 'adapter:tauri', color: 'A179C5', description: 'Tauri adapter · Set: manual' },
  { name: 'adapter:electron', color: 'aaaaaa', description: 'Electron adapter · Set: manual' },
  { name: 'adapter:cf-worker', color: 'aaaaaa', description: 'Cloudflare Worker adapter · Set: manual' },
]

const livestoreSyncLabels: readonly LabelDef[] = [
  { name: 'syncing', color: 'A7F49D', description: 'Sync engine and protocol · Set: manual' },
  { name: 'syncing:cf', color: 'aaaaaa', description: 'Cloudflare sync provider · Set: manual' },
  { name: 'syncing:electric', color: 'f62dc9', description: 'ElectricSQL sync provider · Set: manual' },
]

const livestoreIntegrationLabels: readonly LabelDef[] = [
  { name: 'integration:react', color: 'F59F2A', description: 'React integration · Set: manual' },
  { name: 'integration:solid', color: 'AEDF23', description: 'Solid integration · Set: manual' },
  { name: 'integration:svelte', color: 'aaaaaa', description: 'Svelte integration · Set: manual' },
  { name: 'integration:redwood', color: 'aaaaaa', description: 'RedwoodJS integration · Set: manual' },
  { name: 'integration', color: 'ededed', description: 'Framework integration (general) · Set: manual' },
]

const livestoreDomainLabels: readonly LabelDef[] = [
  { name: 'devtools', color: '95B190', description: 'Devtools · Set: manual' },
  { name: 'sqlite', color: '044a64', description: 'SQLite / storage engine · Set: manual' },
  { name: 'event-sourcing', color: '379FA5', description: 'Event sourcing / eventlog · Set: manual' },
  { name: 'performance', color: '71B373', description: 'Performance · Set: manual' },
  { name: 'testing', color: '5D3AC4', description: 'Testing · Set: manual' },
  { name: 'schema', color: 'aaaaaa', description: 'Schema / state definition · Set: manual' },
  { name: 'api', color: 'ededed', description: 'Public API surface · Set: manual' },
  { name: 'error-handling', color: 'aaaaaa', description: 'Error handling · Set: manual' },
  { name: 'cli', color: 'd23bad', description: 'CLI · Set: manual' },
  { name: 'mono-cli', color: 'ededed', description: 'mono CLI · Set: manual' },
  { name: 'migrations', color: 'AEC97D', description: 'Schema / data migrations · Set: manual' },
  { name: 'otel', color: '80bbda', description: 'OpenTelemetry · Set: manual' },
  { name: 'compatibility', color: 'E569AE', description: 'Compatibility · Set: manual' },
  { name: 'commands', color: '1d76db', description: 'Commands API · Set: manual' },
  { name: 'cross-store', color: '6B8E23', description: 'Cross-store communication and synchronization · Set: manual' },
  { name: 'vite-plugin', color: '907C03', description: 'Vite plugin · Set: manual' },
  { name: 'queries', color: '0E7203', description: 'Queries · Set: manual' },
  { name: 'query-builder', color: 'aaaaaa', description: 'Query builder · Set: manual' },
  { name: 'encryption', color: '79ABC2', description: 'Encryption · Set: manual' },
  { name: 'webmesh', color: 'aaaaaa', description: 'Webmesh transport · Set: manual' },
  { name: 'breaking-change', color: 'B60205', description: 'Breaking change · Set: manual' },
  { name: 'web:ssr', color: 'f2e7f6', description: 'SSR / server rendering · Set: manual' },
  { name: 'website', color: 'aaaaaa', description: 'Website / docs site · Set: manual' },
  { name: 'ci:deploy-docs', color: '0E8A16', description: 'Trigger docs deployment for fork PRs · Set: manual' },
]

/** Workflow / process / experience labels specific to livestore. */
const livestoreProcessLabels: readonly LabelDef[] = [
  { name: 'DX', color: '516C68', description: 'Developer experience · Set: manual' },
  { name: 'design decision', color: '4D75C6', description: 'Design decision / RFC · Set: manual' },
  { name: 'feedback-wanted', color: 'D27A82', description: 'Feedback wanted · Set: manual' },
  { name: 'setup', color: '1DF145', description: 'Setup / getting started · Set: manual' },
  { name: 'infrastructure', color: 'ededed', description: 'Repo infrastructure · Set: manual' },
  { name: 'contributor-experience', color: 'ededed', description: 'Contributor experience · Set: manual' },
  { name: 'exploration', color: 'ededed', description: 'Open-ended exploration · Set: manual' },
  { name: 'experiment', color: '49EEE7', description: 'Bounded experiment / spike · Set: manual' },
  { name: 'ergonomics', color: 'aaaaaa', description: 'API ergonomics · Set: manual' },
  { name: 'optimization', color: 'aaaaaa', description: 'Optimization · Set: manual' },
  { name: 'example', color: '2484B8', description: 'Example app · Set: manual' },
  { name: 'examples', color: 'ededed', description: 'Examples · Set: manual' },
  { name: 'needs-repro', color: '1382D1', description: 'Needs a reproduction · Set: manual' },
  { name: 'needs-info', color: 'fef2c0', description: 'More information needed · Set: manual' },
  { name: 'has-workaround', color: 'aaaaaa', description: 'Has a known workaround · Set: manual' },
]

/**
 * Legacy migrations before deletion. The shared `legacyMigrations` covers the
 * GitHub defaults (`bug`/`enhancement`/`documentation`). livestore adds:
 *   - `docs` → `type:docs` (livestore used `docs`, not `documentation`)
 *   - `needs-research` / `blocked-upstream` → `state:*`
 *   - `refactor` → `type:refactor` (the label that motivated the shared axis)
 *   - the three bare `area:*` collisions (`ci`/`effect`/`tooling`)
 * The reconciler moves issues onto the target then leaves the (now-empty) source
 * label in place; a follow-up can delete the emptied legacy labels.
 */
const livestoreLegacyMigrations = [
  { from: 'docs', to: 'type:docs' },
  { from: 'needs-research', to: 'state:needs-research' },
  { from: 'blocked-upstream', to: 'state:blocked' },
  { from: 'refactor', to: 'type:refactor' },
  { from: 'ci', to: 'area:ci' },
  { from: 'effect', to: 'area:effect' },
  { from: 'tooling', to: 'area:tooling' },
] as const

export default githubLabels({
  labels: [
    ...commonLabels,
    ...livestoreAdapterLabels,
    ...livestoreSyncLabels,
    ...livestoreIntegrationLabels,
    ...livestoreDomainLabels,
    ...livestoreProcessLabels,
  ],
  // Delete the vestigial `mq:*` merge-queue labels (livestore is not Hypermerge-enrolled)
  // alongside the GitHub defaults.
  deprecated: [...deprecatedDefaults, ...mqDeprecated],
  legacyMigrations: [...legacyMigrations, ...livestoreLegacyMigrations],
})
