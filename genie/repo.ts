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
  defineCatalog,
  packageJson,
  tsconfigJson,
  oxlintConfig,
  oxfmtConfig,
  pnpmWorkspaceYaml,
} from '../repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

export { tsconfigJson, packageJson, oxlintConfig, oxfmtConfig, pnpmWorkspaceYaml }

import {
  catalog as effectUtilsCatalog,
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions as effectUtilsPackageTsconfigCompilerOptions,
  domLib,
  reactJsx,
} from '../repos/effect-utils/genie/external.ts'
import {
  livestoreOnlyCatalog,
  livestoreWorkspaceCatalog,
} from './external.ts'

export { baseTsconfigCompilerOptions, domLib, reactJsx }

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
 * Each package has its own pnpm-workspace.yaml that includes sibling packages.
 * This enables:
 * 1. Per-package workspace setup (no monorepo root workspace needed)
 * 2. External consumption via workspace:* when consumers include these in their workspace
 * 3. Proper symlink resolution in both internal and external contexts
 */

/** Composed catalog - effect-utils base + livestore-specific + workspace packages */
export const catalog = defineCatalog({
  extends: effectUtilsCatalog,
  packages: {
    ...livestoreWorkspaceCatalog,
    ...livestoreOnlyCatalog,
  },
})

// =============================================================================
// Package Config Exports
// =============================================================================

/** Common fields for published @livestore packages */
export const livestorePackageDefaults = {
  version: process.env.LIVESTORE_RELEASE_VERSION ?? '0.4.0-dev.22',
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
// pnpm Workspace Configuration
// =============================================================================

/**
 * Direct workspace dependencies for each @livestore package.
 *
 * Maps package dirname (e.g., 'common') to its direct workspace dep dirnames.
 * This is the single source of truth for workspace dependency relationships.
 * Both `pnpm-workspace.yaml.genie.ts` and this graph should stay in sync
 * with `package.json.genie.ts` workspace:* dependencies.
 *
 * When adding a workspace dependency to a package.json.genie.ts, add it here too.
 * The `resolveTransitiveDeps` function will automatically include all transitive deps
 * in the generated pnpm-workspace.yaml files.
 */
const workspaceDeps: Record<string, readonly string[]> = {
  utils: [],
  'utils-dev': ['utils'],
  'wa-sqlite': [],
  'peer-deps': [],
  webmesh: ['utils', 'utils-dev'],
  common: ['utils', 'webmesh', 'utils-dev'],
  'common-cf': ['utils', 'utils-dev'],
  'effect-playwright': ['utils'],
  'devtools-web-common': ['common', 'utils', 'webmesh'],
  'sqlite-wasm': ['common', 'common-cf', 'utils', 'wa-sqlite'],
  'sync-cf': ['common', 'common-cf', 'utils'],
  'sync-electric': ['common', 'utils'],
  livestore: ['common', 'utils', 'adapter-web', 'utils-dev'],
  'adapter-web': ['common', 'devtools-web-common', 'sqlite-wasm', 'utils', 'webmesh'],
  'adapter-node': ['common', 'sqlite-wasm', 'utils', 'webmesh'],
  'adapter-expo': ['common', 'utils', 'webmesh'],
  'adapter-cloudflare': ['common', 'common-cf', 'livestore', 'sqlite-wasm', 'sync-cf', 'utils'],
  cli: ['adapter-node', 'common', 'livestore', 'peer-deps', 'utils', 'utils-dev'],
  'framework-toolkit': ['adapter-web', 'common', 'livestore', 'utils', 'utils-dev'],
  graphql: ['common', 'livestore', 'utils'],
  react: ['common', 'framework-toolkit', 'livestore', 'utils', 'adapter-web', 'utils-dev'],
  solid: ['common', 'framework-toolkit', 'livestore', 'utils', 'adapter-web', 'utils-dev'],
  svelte: ['common', 'livestore', 'utils', 'adapter-web', 'utils-dev'],
  'sync-s2': ['common', 'livestore', 'utils'],
  'devtools-expo': ['adapter-node', 'utils'],
} as const

/** Resolve transitive closure of workspace dependency short names. */
const resolveTransitivePackageNames = (packageNames: readonly string[]): string[] => {
  const result = new Set<string>()
  const visit = (name: string) => {
    if (result.has(name)) return
    result.add(name)
    const deps = workspaceDeps[name]
    if (deps) for (const dep of deps) visit(dep)
  }
  for (const name of packageNames) {
    if (name in workspaceDeps) visit(name)
  }
  return [...result].toSorted()
}

/**
 * Compute the transitive closure of workspace dependencies for a set of direct deps.
 *
 * Given direct dependency patterns (e.g., '../common', '../utils'), resolves all
 * transitive workspace dependencies by following the `workspaceDeps` graph.
 * This ensures pnpm can resolve `workspace:*` specifiers for all nested deps.
 *
 * Only resolves patterns matching `../<name>` (sibling @livestore packages).
 * Non-matching patterns (e.g., `../../@livestore/*` globs) are passed through as-is.
 */
const resolveTransitiveDeps = (patterns: string[]): string[] => {
  const nonResolvable: string[] = []
  const names: string[] = []
  for (const pattern of patterns) {
    const match = pattern.match(/^\.\.\/([^/]+)$/)
    if (match && match[1] in workspaceDeps) {
      names.push(match[1])
    } else {
      nonResolvable.push(pattern)
    }
  }

  return [...nonResolvable, ...resolveTransitivePackageNames(names).map((name) => `../${name}`)]
}

/**
 * Per-package pnpm workspace configuration with automatic transitive dependency resolution.
 *
 * Following effect-utils best practices:
 * - Each package lists its direct workspace dependencies
 * - Transitive deps are automatically computed via `workspaceDeps` graph
 * - Includes dedupePeerDependents to prevent duplicate dependency resolution
 *
 * @param patterns - Direct workspace dependency paths (e.g., '../utils', '../common')
 *                   Pass no args for standalone packages with no workspace deps
 *
 * @example
 * // Standalone package (no workspace deps)
 * pnpmWorkspace()
 *
 * // Package with specific deps (transitive deps resolved automatically)
 * pnpmWorkspace('../utils', '../common')
 */
export const pnpmWorkspace = (...patterns: string[]) =>
  pnpmWorkspaceYaml({
    packages: ['.', ...resolveTransitiveDeps(patterns)],
    dedupePeerDependents: true,
  })

/**
 * pnpm workspace for React packages.
 * Adds publicHoistPattern to ensure single React instance across packages.
 * Automatically resolves transitive workspace dependencies.
 *
 * @param patterns - Direct workspace dependency paths
 */
export const pnpmWorkspaceReact = (...patterns: string[]) =>
  pnpmWorkspaceYaml({
    packages: ['.', ...resolveTransitiveDeps(patterns)],
    dedupePeerDependents: true,
    publicHoistPattern: ['react', 'react-dom', 'react-reconciler'],
  })

/**
 * pnpm workspace for Expo/React Native packages.
 * Hoists React Native related packages to prevent bundler issues.
 * Automatically resolves transitive workspace dependencies.
 *
 * @param patterns - Direct workspace dependency paths
 */
export const pnpmWorkspaceExpo = (...patterns: string[]) =>
  pnpmWorkspaceYaml({
    packages: ['.', ...resolveTransitiveDeps(patterns)],
    dedupePeerDependents: true,
    publicHoistPattern: ['react', 'react-dom', 'react-reconciler', 'react-native', 'expo', 'expo-*'],
  })

/**
 * pnpm workspace for test packages at tests/<name>/.
 * Uses explicit transitive dep resolution instead of globs to avoid
 * overlapping workspace symlink conflicts between test workspaces.
 *
 * @param packageNames - Direct @livestore package short names (e.g., 'common', 'utils')
 * @param extraPackages - Additional non-@livestore workspace paths
 */
export const pnpmWorkspaceTests = (packageNames: readonly string[], extraPackages?: readonly string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveTransitivePackageNames(packageNames).map((n) => `../../packages/@livestore/${n}`),
      ...(extraPackages ?? []),
    ],
    dedupePeerDependents: true,
  })

/**
 * pnpm workspace for test packages that need React hoisting.
 * Uses explicit transitive dep resolution instead of globs.
 *
 * @param packageNames - Direct @livestore package short names
 * @param extraPackages - Additional non-@livestore workspace paths
 */
export const pnpmWorkspaceTestsReact = (packageNames: readonly string[], extraPackages?: readonly string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveTransitivePackageNames(packageNames).map((n) => `../../packages/@livestore/${n}`),
      ...(extraPackages ?? []),
    ],
    dedupePeerDependents: true,
    publicHoistPattern: ['react', 'react-dom', 'react-reconciler'],
  })

// =============================================================================
// Effect Peer Dependency Helpers
// =============================================================================

/**
 * Core Effect ecosystem peer dependencies for @livestore/utils.
 * These are the packages that utils exposes types from and consumers need.
 *
 * Usage pattern:
 * - Include in devDependencies via catalog.pick() for local development
 * - Include in peerDependencies via catalog.peers() for consumers
 */
export const utilsEffectPeerDeps = [
  'effect',
  '@effect/platform',
  '@effect/platform-browser',
  '@effect/platform-bun',
  '@effect/platform-node',
  '@effect/ai',
  '@effect/cli',
  '@effect/cluster',
  '@effect/experimental',
  '@effect/opentelemetry',
  '@effect/printer',
  '@effect/printer-ansi',
  '@effect/rpc',
  '@effect/sql',
  '@effect/typeclass',
  '@opentelemetry/api',
  '@opentelemetry/resources',
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

// =============================================================================
// GitHub Workflow Helpers
// =============================================================================

export { githubWorkflow } from '../repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

import {
  namespaceRunner as namespaceRunnerBase,
  devenvShellDefaults,
  installNixStep,
  cachixStep,
  installMegarepoStep,
  syncMegarepoStep,
  installDevenvFromLockStep,
  validateNixStoreStep,
  checkoutStep,
} from '../repos/effect-utils/genie/ci-workflow.ts'

export { devenvShellDefaults }

export const namespaceRunner = (runId: string) =>
  namespaceRunnerBase('namespace-profile-linux-x86-64', runId)

/**
 * Setup steps for livestore CI jobs (without checkout).
 * Uses shared step atoms from effect-utils/genie/ci-workflow.ts.
 *
 * Note: We use DEVENV_SKIP_SETUP=1 to prevent enterShell from running setup
 * tasks via nested devenv processes (which fail in GitHub Actions due to
 * temp script file access issues). Instead, setup tasks are run explicitly
 * via `devenv tasks run`.
 */
export const livestoreSetupStepsAfterCheckout = [
  installNixStep({
    extraConf:
      'extra-substituters = https://cache.nixos.org\nextra-trusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=',
  }),
  cachixStep({ name: 'livestore', authToken: '${{ env.CACHIX_AUTH_TOKEN }}' }),
  installMegarepoStep,
  syncMegarepoStep(),
  installDevenvFromLockStep,
  validateNixStoreStep,
] as const

/**
 * Full setup steps for livestore CI jobs (includes checkout).
 * Use livestoreSetupStepsAfterCheckout if you need a custom checkout step.
 */
export const livestoreSetupSteps = [checkoutStep(), ...livestoreSetupStepsAfterCheckout] as const

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

/** All @livestore package short names (directory names under packages/@livestore/) */
const livestorePackageNames = [
  'utils',
  'utils-dev',
  'common',
  'common-cf',
  'livestore',
  'react',
  'solid',
  'svelte',
  'adapter-web',
  'adapter-node',
  'adapter-expo',
  'adapter-cloudflare',
  'sqlite-wasm',
  'webmesh',
  'devtools-web-common',
  'devtools-expo',
  'graphql',
  'sync-cf',
  'sync-s2',
  'sync-electric',
  'cli',
  'effect-playwright',
  'framework-toolkit',
  'peer-deps',
  'wa-sqlite',
] as const

type LivestorePackageName = (typeof livestorePackageNames)[number]
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
  livestorePackageNames.map((name) => [toCamelCase(name), { path: `../${name}` }]),
) as { [K in LivestoreRefKey]: { path: string } }
