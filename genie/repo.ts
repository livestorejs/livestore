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
const workspaceCatalog = {
  // @livestore/* packages
  '@livestore/utils': 'workspace:*',
  '@livestore/utils-dev': 'workspace:*',
  '@livestore/common': 'workspace:*',
  '@livestore/common-cf': 'workspace:*',
  '@livestore/livestore': 'workspace:*',
  '@livestore/react': 'workspace:*',
  '@livestore/solid': 'workspace:*',
  '@livestore/svelte': 'workspace:*',
  '@livestore/adapter-web': 'workspace:*',
  '@livestore/adapter-node': 'workspace:*',
  '@livestore/adapter-expo': 'workspace:*',
  '@livestore/adapter-cloudflare': 'workspace:*',
  '@livestore/sqlite-wasm': 'workspace:*',
  '@livestore/webmesh': 'workspace:*',
  '@livestore/devtools-web-common': 'workspace:*',
  '@livestore/devtools-expo': 'workspace:*',
  '@livestore/graphql': 'workspace:*',
  '@livestore/sync-cf': 'workspace:*',
  '@livestore/sync-s2': 'workspace:*',
  '@livestore/sync-electric': 'workspace:*',
  '@livestore/cli': 'workspace:*',
  '@livestore/effect-playwright': 'workspace:*',
  '@livestore/framework-toolkit': 'workspace:*',
  '@livestore/peer-deps': 'workspace:*',
  '@livestore/wa-sqlite': 'workspace:*',

  // @local/* packages (internal tooling)
  '@local/astro-tldraw': 'workspace:*',
  '@local/astro-twoslash-code': 'workspace:*',
  '@local/shared': 'workspace:*',
  '@local/docs': 'workspace:*',
  '@local/scripts': 'workspace:*',
  '@local/tests-integration': 'workspace:*',
  '@local/tests-package-common': 'workspace:*',
  '@local/tests-perf': 'workspace:*',
  '@local/tests-perf-streaming-loopback': 'workspace:*',
  '@local/tests-sync-provider': 'workspace:*',
  '@local/tests-wa-sqlite': 'workspace:*',
} as const

/** LiveStore-specific packages not in effect-utils catalog */
const livestoreOnlyCatalog = {
  // Published @livestore packages (not workspace packages)
  '@livestore/devtools-vite': '0.4.0-dev.22',

  // Build/lint tools
  '@biomejs/biome': '2.3.8',

  // Additional type packages
  '@types/chrome': '0.1.4',
  '@types/web': '0.0.264',
  '@types/hast': '3.0.4',
  '@types/jasmine': '5.1.4',
  '@types/jsdom': '21.1.7',
  '@types/wicg-file-system-access': '2023.10.6',

  // Additional build tools
  '@vitest/ui': '3.2.4',

  // SolidJS ecosystem
  'solid-js': '1.9.10',
  '@solidjs/testing-library': '0.8.10',

  // Additional testing tools
  '@testing-library/dom': '10.4.1',
  '@testing-library/jest-dom': '6.6.3',
  '@testing-library/svelte': '5.2.4',
  '@web/dev-server': '0.4.6',
  '@web/test-runner': '0.20.0',
  '@web/test-runner-core': '0.13.4',
  'jasmine-core': '4.5.0',
  jsdom: '26.1.0',
  'web-test-runner-jasmine': '0.0.6',

  // Additional Effect packages
  '@effect/ai-openai': '0.37.2',
  '@effect/platform-browser': '0.73.0',
  '@effect/platform-bun': '0.86.0',
  '@effect/platform-node-shared': '0.56.0',
  '@effect/sql-sqlite-node': '0.49.1',

  // Additional OpenTelemetry packages (base packages inherited from effect-utils)
  '@opentelemetry/context-zone': '2.2.0',
  '@opentelemetry/core': '2.2.0',
  '@opentelemetry/exporter-metrics-otlp-grpc': '0.208.0',
  '@opentelemetry/exporter-metrics-otlp-http': '0.208.0',
  '@opentelemetry/exporter-trace-otlp-grpc': '0.208.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.208.0',
  '@opentelemetry/otlp-exporter-base': '0.208.0',
  '@opentelemetry/otlp-transformer': '0.208.0',

  // Common utilities
  graphql: '16.11.0',
  comlink: '4.4.1',
  'react-window': '1.8.11',
  'monaco-editor': '0.34.1',
  nanoid: '5.0.9',
  'pretty-bytes': '7.0.1',
  'qrcode-generator': '1.4.4',
  '@standard-schema/spec': '1.0.0',
  '@iarna/toml': '3.0.0',
  '@graphql-typed-document-node/core': '3.2.0',

  // Astro ecosystem for docs
  'astro-expressive-code': '0.41.5',
  'expressive-code': '0.41.5',
  'expressive-code-twoslash': '0.5.3',
  hast: '1.0.0',
  'hast-util-to-html': '9.0.4',
  '@kitschpatrol/tldraw-cli': '5.0.1',

  // Rollup
  rollup: '4.49.0',
  '@rollup/plugin-commonjs': '28.0.6',
  '@rollup/plugin-node-resolve': '16.0.1',
  '@rollup/plugin-terser': '0.4.4',

  // Svelte
  svelte: '5.43.14',
  '@sveltejs/vite-plugin-svelte': '6.2.1',

  // Astro/docs
  astro: '5.13.4',
  '@astrojs/starlight': '0.35.2',
  typedoc: '0.28.11',

  // Expo/React Native
  expo: '54.0.12',
  'expo-application': '7.0.7',
  'expo-sqlite': '16.0.8',
  'react-native': '0.81.4',

  // Cloudflare tools
  wrangler: '4.42.2',
  '@cloudflare/workers-types': '4.20251118.0',

  // Development tools
  husky: '9.1.7',
  madge: '8.0.0',
  yaml: '2.8.1',
} as const

/**
 * Override @playwright/test version to match nix-provided browser revision.
 * The nix playwright-web-flake provides browsers for 1.58.0 (chromium rev 1208),
 * but effect-utils catalog still pins 1.57.0 (chromium rev 1200).
 * defineCatalog doesn't support overrides, so we patch the base catalog object directly.
 */
const effectUtilsCatalogPatched = Object.assign(Object.create(Object.getPrototypeOf(effectUtilsCatalog)), {
  ...effectUtilsCatalog,
  '@playwright/test': '1.58.0',
})

/** Composed catalog - effect-utils base + livestore-specific + workspace packages */
export const catalog = defineCatalog({
  extends: effectUtilsCatalogPatched,
  packages: {
    ...workspaceCatalog,
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
    if (match && match[1]! in workspaceDeps) {
      names.push(match[1]!)
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

/**
 * Namespace runner configuration for livestore CI.
 * Uses run ID-based labels for runner affinity to prevent queue jumping.
 */
export const namespaceRunner = (runId: string) =>
  ['namespace-profile-linux-x86-64', `namespace-features:github.run-id=${runId}`] as const

/** Standard devenv shell for CI jobs */
export const devenvShellDefaults = {
  run: { shell: 'devenv shell bash -- -e {0}' },
} as const

/**
 * Setup steps for livestore CI jobs (without checkout).
 * Installs Nix, enables Cachix caching, syncs megarepo dependencies, and warms up devenv.
 * Use this when you need a custom checkout step (e.g., with specific ref).
 *
 * Note: We use DEVENV_SKIP_SETUP=1 to prevent enterShell from running setup
 * tasks via nested devenv processes (which fail in GitHub Actions due to
 * temp script file access issues). Instead, setup tasks are run explicitly
 * via `devenv tasks run`.
 */
export const livestoreSetupStepsAfterCheckout = [
  { name: 'Install Nix', uses: 'cachix/install-nix-action@v31' },
  {
    name: 'Enable Cachix cache',
    uses: 'cachix/cachix-action@v16',
    with: { name: 'livestore', authToken: '${{ env.CACHIX_AUTH_TOKEN }}' },
  },
  {
    name: 'Install megarepo CLI',
    run: 'nix profile install github:overengineeringstudio/effect-utils#megarepo',
    shell: 'bash',
  },
  {
    name: 'Sync megarepo dependencies',
    run: 'mr sync --frozen --verbose',
    shell: 'bash',
  },
  {
    name: 'Install devenv',
    // Add nix profile to PATH for subsequent steps that use devenv shell
    run: `nix profile install nixpkgs#devenv
echo "$HOME/.nix-profile/bin" >> $GITHUB_PATH`,
    shell: 'bash',
  },
  {
    // Warmup Nix shell and run setup tasks explicitly
    // DEVENV_SKIP_SETUP=1 prevents enterShell from running nested devenv processes
    // which fail in GitHub Actions due to temp script file access issues
    name: 'Setup devenv and run tasks',
    run: `DEVENV_SKIP_SETUP=1 devenv tasks run pnpm:install genie:run ts:build --mode before --verbose`,
    shell: 'bash',
  },
] as const

/**
 * Full setup steps for livestore CI jobs (includes checkout).
 * Use livestoreSetupStepsAfterCheckout if you need a custom checkout step.
 */
export const livestoreSetupSteps = [{ uses: 'actions/checkout@v4' }, ...livestoreSetupStepsAfterCheckout] as const

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
