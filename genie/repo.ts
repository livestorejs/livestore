/**
 * LiveStore monorepo configuration
 *
 * Extends effect-utils catalog with livestore-specific packages.
 * Uses genie from @overeng/genie for config file generation.
 *
 * ## Design Decisions
 *
 * ### Examples are not managed by genie
 * The `examples/` directory is intentionally excluded from genie management.
 * Examples must remain standalone and self-contained so users can copy them
 * directly without any genie dependencies or monorepo-specific configuration.
 * Each example has its own package.json, tsconfig.json, etc. that are manually
 * maintained to reflect what a real user project would look like.
 */

import {
  catalog as effectUtilsCatalog,
  baseOxlintCategories,
  baseOxlintIgnorePatterns,
  baseOxlintPlugins,
  baseTsconfigCompilerOptions as effectUtilsBaseTsconfigCompilerOptions,
  commonPnpmPolicySettings,
  defineCatalog,
  defineRepoContext,
  domLib as effectUtilsDomLib,
  githubRuleset,
  githubWorkflow,
  megarepoJson,
  oxfmtConfig,
  oxlintConfig,
  packageTsconfigCompilerOptions as effectUtilsPackageTsconfigCompilerOptions,
  packageJson,
  type PnpmPackageClosureConfig,
  pnpmWorkspaceYaml,
  projectionArtifact,
  reactJsx,
  tsconfigJson,
  type PackageJsonData,
  type PnpmWorkspaceData,
  type WorkspaceIdentity,
  type WorkspaceMeta,
  type WorkspaceMetadata,
  type WorkspacePackage,
  type WorkspacePackageLike,
} from '#mr/effect-utils/genie/external.ts'
import { baseOxfmtIgnorePatterns, baseOxfmtOptions } from '#mr/effect-utils/genie/oxfmt-base.ts'

import {
  effectV4Catalog,
  livestoreOnlyCatalog,
  livestoreWorkspaceCatalog,
  obsoleteEffectV3Packages,
} from './external.ts'
import { livestoreCurrentPackageNames, type LivestorePackageName } from './repo-topology.ts'

export { baseTsconfigCompilerOptions, reactJsx }
export {
  baseOxfmtIgnorePatterns,
  baseOxfmtOptions,
  baseOxlintCategories,
  baseOxlintIgnorePatterns,
  baseOxlintPlugins,
  commonPnpmPolicySettings,
  githubRuleset,
  githubWorkflow,
  megarepoJson,
  oxfmtConfig,
  oxlintConfig,
  packageJson,
  pnpmWorkspaceYaml,
  projectionArtifact,
  tsconfigJson,
}
export type {
  PackageJsonData,
  PnpmPackageClosureConfig,
  PnpmWorkspaceData,
  WorkspaceIdentity,
  WorkspaceMeta,
  WorkspaceMetadata,
  WorkspacePackage,
  WorkspacePackageLike,
}

// TODO: Remove this once effect-utils carries the TS 6 DOM lib cleanup upstream:
// https://github.com/overengineeringstudio/effect-utils/issues/892
// TypeScript 6 folds DOM iterable and async-iterable declarations into DOM.
export const domLib = effectUtilsDomLib.filter((lib) => lib !== 'DOM.Iterable' && lib !== 'DOM.AsyncIterable')

// Strip inherited options that now match defaults so generated
// tsconfigs only carry LiveStore-specific intent. `plugins` is pulled out
// separately so we can override the Effect-LSP exit-code gate below.
const {
  allowJs: _allowJs,
  esModuleInterop: _esModuleInterop,
  allowSyntheticDefaultImports: _allowSyntheticDefaultImports,
  forceConsistentCasingInFileNames: _forceConsistentCasingInFileNames,
  moduleResolution: _moduleResolution,
  strict: _strict,
  plugins: inheritedTsconfigPlugins,
  ...baseTsconfigCompilerOptionsWithoutPlugins
} = effectUtilsBaseTsconfigCompilerOptions

/**
 * #811 Effect-LSP gate — deferred warning/suggestion burndown.
 *
 * effect-utils sets `effectDiagnosticsGate = { warnings: true, suggestions: true }`,
 * so its `@effect/language-service` plugin config fails `tsgo --build` on every
 * Effect *warning* and *suggestion*, not just errors. Adopting this effect-utils
 * revision surfaced ~406 pre-existing advisory diagnostics (duplicatePackage,
 * schemaNumber, preferSchemaOverJson, …) across the LiveStore tree.
 *
 * For this effect-utils bump we restore LiveStore's pre-bump gating — ERRORS only —
 * by flipping just the two exit-code flags. Warnings/suggestions stay VISIBLE in
 * build output (advisory) but no longer fail the build; real Effect errors (e.g.
 * the `missingReturnYieldStar` bugs fixed in this PR) still gate hard via the
 * inherited `ignoreEffectErrorsInTscExitCode: false`. The full warning/suggestion
 * burndown to the #811 Effect-LSP bar is deferred to a dedicated follow-up PR.
 * This mirrors effect-utils' own `effectDiagnosticsGate` phased-adoption design.
 */
const baseTsconfigCompilerOptions = {
  ...baseTsconfigCompilerOptionsWithoutPlugins,
  plugins: inheritedTsconfigPlugins.map((plugin) =>
    plugin.name === '@effect/language-service'
      ? { ...plugin, ignoreEffectWarningsInTscExitCode: true, ignoreEffectSuggestionsInTscExitCode: true }
      : plugin,
  ),
} as const

/**
 * Package tsconfig compiler options for livestore.
 * Uses src/ as rootDir (effect-utils uses . for rootDir).
 */
export const packageTsconfigCompilerOptions = {
  ...effectUtilsPackageTsconfigCompilerOptions,
  rootDir: './src',
  tsBuildInfoFile: './dist/.tsbuildinfo',
} as const

/**
 * Internal workspace packages using workspace:* protocol.
 *
 * The repo-root pnpm workspace is the authoritative install owner and lockfile
 * source of truth. Package closures are derived from workspace metadata at
 * build time instead of being committed as package-local pnpm-workspace files.
 */

const repo = defineRepoContext({
  name: 'livestore',
  importMetaUrl: import.meta.url,
})

const releaseVersion = repo.readJson<{
  readonly version: string
}>('release/version.json')

/** TODO: Remove once effect-utils upgrades its TypeScript catalog pin: https://github.com/overengineeringstudio/effect-utils/issues/892 */
const livestoreCatalogOverrides = {
  typescript: '6.0.3',
} as const

const obsoleteEffectV3PackageNames = new Set<string>(obsoleteEffectV3Packages)

const effectV4CatalogPackageNames = new Set<string>(Object.keys(effectV4Catalog))

/**
 * Keep inheriting non-Effect tooling versions from effect-utils while LiveStore
 * owns the Effect v4 package surface for this migration slice.
 */
const effectUtilsCatalogWithoutEffectV3 = Object.fromEntries(
  Object.entries(effectUtilsCatalog).filter(
    ([name]) => obsoleteEffectV3PackageNames.has(name) === false && effectV4CatalogPackageNames.has(name) === false,
  ),
)

/** Composed catalog - effect-utils base + LiveStore overrides + Effect v4 + livestore-specific + workspace packages */
export const catalog = defineCatalog({
  ...effectUtilsCatalogWithoutEffectV3,
  ...livestoreCatalogOverrides,
  ...effectV4Catalog,
  ...livestoreWorkspaceCatalog,
  ...livestoreOnlyCatalog,
})

const WORKSPACE_REPO_NAME = 'livestore'

export const workspaceMember = (
  memberPath: string,
  pnpmPackageClosure: PnpmPackageClosureConfig = {},
): WorkspaceIdentity => ({
  repoName: WORKSPACE_REPO_NAME,
  memberPath,
  pnpmPackageClosure,
})

export const repoPnpmAllowBuilds = {
  ...commonPnpmPolicySettings.allowBuilds,
  '@parcel/watcher': true,
  '@mixedbread/cli': true,
  'cbor-extract': true,
  'dtrace-provider': true,
  protobufjs: true,
  puppeteer: true,
  workerd: true,
} as const

export const repoPnpmOnlyBuiltDependencies = Object.entries(repoPnpmAllowBuilds)
  .filter(([, isAllowed]) => isAllowed === true)
  .map(([name]) => name)
  .toSorted()

/** Repo-specific pnpm packageExtensions for starlight/typedoc peer resolution */
export const repoPackageExtensions = {
  '@livestore/devtools-vite': {
    dependencies: {
      '@parcel/watcher': '^2.5.6',
    },
  },
  'starlight-auto-sidebar': { dependencies: { astro: '>=5.0.0' } },
  'starlight-links-validator': { dependencies: { astro: '>=5.0.0' } },
  'starlight-sidebar-topics': { dependencies: { astro: '>=5.0.0' } },
  typedoc: { dependencies: { 'typedoc-plugin-markdown': '^4.8.1' } },
} as const

// =============================================================================
// Package Config Exports
// =============================================================================

/** Common fields for published @livestore packages */
export const livestorePackageDefaults = {
  version: process.env.LIVESTORE_RELEASE_VERSION ?? releaseVersion.version,
  type: 'module' as const,
  sideEffects: false as const,
  license: 'Apache-2.0' as const,
  files: ['dist', 'package.json', 'src'],
  repository: { type: 'git', url: 'git+https://github.com/livestorejs/livestore.git' },
}

/** Common fields for private @local packages (internal tooling) */
export const localPackageDefaults = {
  version: '0.0.0',
  type: 'module' as const,
  private: true as const,
}

// =============================================================================
// Effect Peer Dependency Helpers
// =============================================================================

/**
 * Peer dependencies for the public @livestore/utils surface.
 * These are the packages that utils exposes types or values from and consumers need.
 * Effect v4 consolidated the old auxiliary Effect packages, so only surviving
 * platform/provider packages remain public peers here.
 *
 * Usage pattern:
 * - Include in devDependencies via catalog.pick() for local development
 * - Include in peerDependencies via catalog.peers() for consumers
 */
export const utilsEffectPeerDeps = [
  'effect',
  '@effect/platform-browser',
  '@effect/platform-bun',
  '@effect/platform-node',
  '@effect/platform-node-shared',
  '@effect/opentelemetry',
  '@effect/vitest',
  '@opentelemetry/api',
  '@opentelemetry/resources',
  '@standard-schema/spec',
] as const

/**
 * Helper to get peer dependencies object from utils package.
 * Used by packages that depend on @livestore/utils to re-expose its peer deps.
 */
export const getUtilsPeerDeps = () => catalog.peers(...utilsEffectPeerDeps)

/**
 * Helper to get dev dependencies for packages using Effect types.
 * Combines peer deps (for local dev) with additional dev-only deps.
 */
export const effectDevDeps = (...additionalDeps: Parameters<typeof catalog.pick>) =>
  catalog.pick(...utilsEffectPeerDeps, ...additionalDeps)

// =============================================================================
// TypeScript Configuration Helpers
// =============================================================================

/** Standard package tsconfig exclude patterns.
 * Excludes node_modules and dist to avoid type-checking copied local packages.
 * See: effect-utils/context/workarounds/pnpm-issues.md
 * Also excludes *.genie.ts files which are only used by genie CLI, not tsc.
 */
export const packageTsconfigExclude = ['node_modules', '**/dist', '**/node_modules/.pnpm', '**/*.genie.ts'] as const

/** Solid JSX configuration */
export const solidJsx = { jsx: 'preserve' as const, jsxImportSource: 'solid-js' }

import {
  bashShellDefaults,
  cachixCliBuildStep,
  cachixStep,
  defaultActionlintConfig,
  dispatchAlignmentStep,
  namespaceRunner as namespaceRunnerBase,
  installNixStep,
  applyMegarepoLockStep,
  checkoutStep,
  defaultRefPolicyCheckJob,
  prepareCiScriptsStep,
  preparePinnedDevenvStep,
  pnpmStateSetupStep,
  restorePnpmStateStep,
  runDevenvTasksBefore,
  nixDiagnosticsArtifactStep,
  savePnpmStateStep,
  validateNixStoreStep,
  workflowReportCollectorStep,
  workflowReportCommentBodyStep,
  workflowReportProducerStep,
  workflowReportPublisherStep,
} from '#mr/effect-utils/genie/ci-workflow.ts'

export const devenvShellDefaults = {
  run: { shell: 'devenv shell bash -- -e {0}' },
} as const
export { bashShellDefaults }
export {
  applyMegarepoLockStep,
  cachixCliBuildStep,
  cachixStep,
  checkoutStep,
  defaultActionlintConfig,
  dispatchAlignmentStep,
  installNixStep,
  nixDiagnosticsArtifactStep,
  pnpmStateSetupStep,
  preparePinnedDevenvStep,
  restorePnpmStateStep,
  runDevenvTasksBefore,
  savePnpmStateStep,
  validateNixStoreStep,
  workflowReportCollectorStep,
  workflowReportCommentBodyStep,
  workflowReportProducerStep,
  workflowReportPublisherStep,
}

export const namespaceRunner = (runId: string) =>
  namespaceRunnerBase({ profile: 'namespace-profile-linux-x86-64', runId })

const shellSingleQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const setupMegarepoRun = (run: string) =>
  run.replace(
    'nix run "github:overengineeringstudio/effect-utils/$EU_REV#megarepo" -- apply --all',
    [
      'nix run --no-write-lock-file',
      '--override-input flake-utils "https://codeload.github.com/numtide/flake-utils/tar.gz/11707dc2f618dd54ca8739b309ec4fc024de578b"',
      '--override-input nixpkgs "https://codeload.github.com/NixOS/nixpkgs/tar.gz/5b63481602d9b0a714d5791c53bebe829d6b1a3c"',
      '--override-input tsgo "https://codeload.github.com/Effect-TS/tsgo/tar.gz/8d34c0a2d603a4b963b85ffccd4322c0ef74f472"',
      '"https://codeload.github.com/overengineeringstudio/effect-utils/tar.gz/$EU_REV#megarepo" -- apply --all',
    ].join(' '),
  )

const withNixSetupRetry = <TStep extends { readonly name: string; readonly run: string }>(step: TStep): TStep => ({
  ...step,
  run: [
    `__genie_ci_retry_script='\${{ runner.temp }}/genie-ci-scripts/run-with-nix-gc-race-retry.sh'`,
    `bash "$__genie_ci_retry_script" ${shellSingleQuote(step.name)} ${shellSingleQuote(setupMegarepoRun(step.run))}`,
  ].join('\n'),
})

/**
 * Setup steps for livestore CI jobs (without checkout).
 * Uses shared step atoms from effect-utils/genie/ci-workflow.ts.
 */
export const livestoreSetupStepsAfterCheckout = [
  // Copy CI helper scripts (e.g. the nix-gc-race retry wrapper) into the prepared
  // scripts dir before any retry-wrapped command runs, and before any alternate
  // checkout can replace the workspace. Required by the genie CI workflow validator.
  prepareCiScriptsStep,
  installNixStep({
    extraConf:
      'extra-substituters = https://cache.nixos.org\nextra-trusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=',
  }),
  cachixCliBuildStep,
  (() => {
    const base = cachixStep({ name: 'livestore', authToken: '${{ env.CACHIX_AUTH_TOKEN }}' })
    return { ...base, with: { ...base.with, skipPush: true } }
  })(),
  withNixSetupRetry(applyMegarepoLockStep()),
  preparePinnedDevenvStep,
  pnpmStateSetupStep,
  restorePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  validateNixStoreStep,
] as const

/**
 * Full setup steps for livestore CI jobs (includes checkout).
 * Use livestoreSetupStepsAfterCheckout if you need a custom checkout step.
 */
export const livestoreSetupSteps = [checkoutStep(), ...livestoreSetupStepsAfterCheckout] as const

/** Dedicated source-policy job so policy failures do not hide test/lint results. */
export const livestoreDefaultRefPolicyJob = defaultRefPolicyCheckJob({
  runsOn: namespaceRunner('${{ github.run_id }}'),
  firstPartyOwners: ['overengineeringstudio'],
  normalizeGitBranchRefs: true,
  verifyReachable: true,
})

/**
 * OTEL configuration step for Grafana Cloud.
 * Sets up authorization headers and endpoint URLs for trace export.
 */
export const otelSetupStep = {
  name: 'Set OTEL_EXPORTER_OTLP_HEADERS environment variable',
  env: {
    GRAFANA_CLOUD_OTLP_INSTANCE_ID: '1227256',
    GRAFANA_CLOUD_OTLP_API_KEY: '${{ secrets.GRAFANA_CLOUD_OTLP_API_KEY }}',
  },
  run: `echo "OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic $(echo -n "$GRAFANA_CLOUD_OTLP_INSTANCE_ID:$GRAFANA_CLOUD_OTLP_API_KEY" | base64 -w 0)" >> $GITHUB_ENV
echo "GRAFANA_ENDPOINT=https://livestore.grafana.net" >> $GITHUB_ENV
echo "OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-2.grafana.net/otlp" >> $GITHUB_ENV
# Disable in Vite (otherwise CORS issues)
echo "VITE_OTEL_EXPORTER_OTLP_ENDPOINT=" >> $GITHUB_ENV`,
}

// =============================================================================
// TypeScript Reference Helpers
// =============================================================================

type LivestoreRefKey = {
  [K in LivestorePackageName]: K extends `${infer A}-${infer B}`
    ? `${A}${Capitalize<B>}` extends `${infer A2}-${infer B2}`
      ? `${A2}${Capitalize<B2>}`
      : `${A}${Capitalize<B>}`
    : K
}[LivestorePackageName]

/** Convert kebab-case to camelCase */
const toCamelCase = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/**
 * Internal refs for use within LiveStore repo.
 * All packages are siblings, so paths are simple relative refs.
 */
export const refs = Object.fromEntries(
  livestoreCurrentPackageNames.map((name) => [toCamelCase(name), { path: `../${name}` }]),
) as { [K in LivestoreRefKey]: { path: string } }
