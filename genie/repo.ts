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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  defineCatalog,
  type GenieOutput,
  type PackageJsonData,
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
  createMegarepoWorkspaceDepsResolver,
  type MegarepoWorkspaceRoot,
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

type PackageJsonGenie = GenieOutput<PackageJsonData>

type WorkspaceRootConfig = {
  id: string
  prefix: string
  path: string
}

type WorkspacePackageName = keyof typeof workspaceCatalog

const workspacePackageNames = Object.keys(workspaceCatalog) as WorkspacePackageName[]

const workspaceRoots = [
  {
    id: 'livestore-packages',
    prefix: '@livestore/',
    path: 'packages/@livestore/',
  },
  {
    id: 'local-packages',
    prefix: '@local/',
    path: 'packages/@local/',
  },
  {
    id: 'local-docs',
    prefix: '@local/docs',
    path: 'docs',
  },
  {
    id: 'local-scripts',
    prefix: '@local/scripts',
    path: 'scripts',
  },
  {
    id: 'local-tests',
    prefix: '@local/tests-',
    path: 'tests/',
  },
] as const satisfies readonly WorkspaceRootConfig[]

const workspaceRootOverrides = Object.fromEntries(
  workspacePackageNames
    .filter((name) => name === '@local/docs' || name === '@local/scripts' || name.startsWith('@local/tests-'))
    .map((name) =>
      name === '@local/docs'
        ? [name, 'local-docs']
        : name === '@local/scripts'
          ? [name, 'local-scripts']
          : [name, 'local-tests'],
    ),
) as Record<string, string>

const repoRootPath = fileURLToPath(new URL('..', import.meta.url))

const resolvePackageDirectory = (packageName: WorkspacePackageName): string => {
  const matchingRoots = workspaceRoots.filter((root) => packageName.startsWith(root.prefix))
  const selectedRoot =
    matchingRoots.length === 1
      ? matchingRoots[0]
      : matchingRoots.find((root) => root.id === workspaceRootOverrides[packageName])

  if (selectedRoot === undefined) {
    throw new Error(`Unable to resolve workspace root for '${packageName}'`)
  }

  const suffix = packageName.slice(selectedRoot.prefix.length)
  return selectedRoot.path.endsWith('/') === true ? `${selectedRoot.path}${suffix}` : `${selectedRoot.path}/${suffix}`
}

const readWorkspacePackageJson = (packageName: WorkspacePackageName): PackageJsonData => {
  const packageJsonPath = join(repoRootPath, resolvePackageDirectory(packageName), 'package.json')
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonData
}

const isWorkspacePackageName = (name: string): name is WorkspacePackageName => name in workspaceCatalog

const collectWorkspaceDependencies = (pkg: PackageJsonData): WorkspacePackageName[] => {
  const names = new Set<WorkspacePackageName>()
  const addDeps = (deps?: Record<string, string>) => {
    if (deps === undefined) return
    for (const name of Object.keys(deps)) {
      if (isWorkspacePackageName(name)) {
        names.add(name)
      }
    }
  }

  addDeps(pkg.dependencies)
  addDeps(pkg.devDependencies)
  addDeps(pkg.peerDependencies)

  return [...names].toSorted((a, b) => a.localeCompare(b))
}

const workspaceDependencyCache = new Map<WorkspacePackageName, readonly WorkspacePackageName[]>()

const getWorkspaceDependencies = (packageName: WorkspacePackageName): readonly WorkspacePackageName[] => {
  const cached = workspaceDependencyCache.get(packageName)
  if (cached !== undefined) return cached

  const dependencies = collectWorkspaceDependencies(readWorkspacePackageJson(packageName))
  workspaceDependencyCache.set(packageName, dependencies)
  return dependencies
}

const resolveTransitiveWorkspacePackageNames = (
  packageNames: readonly WorkspacePackageName[],
): WorkspacePackageName[] => {
  const resolved = new Set<WorkspacePackageName>()

  const visit = (name: WorkspacePackageName) => {
    if (resolved.has(name)) return
    resolved.add(name)

    for (const dep of getWorkspaceDependencies(name)) {
      visit(dep)
    }
  }

  for (const name of packageNames) {
    visit(name)
  }

  return [...resolved].toSorted((a, b) => a.localeCompare(b))
}

const workspacePathResolver = createMegarepoWorkspaceDepsResolver({
  roots: workspaceRoots,
  packageRootOverrides: workspaceRootOverrides,
})

const resolveWorkspacePaths = ({
  packageNames,
  location,
}: {
  packageNames: readonly WorkspacePackageName[]
  location: string
}): string[] => {
  if (packageNames.length === 0) return []

  const pkg = packageJson({
    name: '@local/workspace-path-resolver',
    dependencies: Object.fromEntries(packageNames.map((name) => [name, 'workspace:*'])),
  })

  return workspacePathResolver({ pkg, deps: [], location })
}

const resolveLivestoreWorkspacePatterns = ({
  patterns,
  location,
}: {
  patterns: string[]
  location: string
}): string[] => {
  const directWorkspacePackages: WorkspacePackageName[] = []
  const passthroughPatterns: string[] = []

  for (const pattern of patterns) {
    const match = pattern.match(/^\.\.\/([^/]+)$/)
    if (match === null) {
      passthroughPatterns.push(pattern)
      continue
    }

    const packageName = `@livestore/${match[1]}`
    if (isWorkspacePackageName(packageName)) {
      directWorkspacePackages.push(packageName)
    } else {
      passthroughPatterns.push(pattern)
    }
  }

  const transitivePackageNames = resolveTransitiveWorkspacePackageNames(directWorkspacePackages)
  return [...passthroughPatterns, ...resolveWorkspacePaths({ packageNames: transitivePackageNames, location })]
}

/**
 * Per-package pnpm workspace configuration with dependency-graph based resolution.
 *
 * @param patterns - Direct workspace dependency paths (e.g., '../utils', '../common')
 *                   Pass no args for standalone packages with no workspace deps
 *
 * @example
 * // Standalone package (no workspace deps)
 * pnpmWorkspace()
 *
 * // Package with specific deps (transitive deps resolved from package.json graph)
 * pnpmWorkspace('../utils', '../common')
 */
export const pnpmWorkspace = (...patterns: string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveLivestoreWorkspacePatterns({
        patterns,
        location: 'packages/@livestore/__workspace__',
      }),
    ],
    dedupePeerDependents: true,
  })

/**
 * pnpm workspace for React packages.
 * Adds publicHoistPattern to ensure single React instance across packages.
 *
 * @param patterns - Direct workspace dependency paths
 */
export const pnpmWorkspaceReact = (...patterns: string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveLivestoreWorkspacePatterns({
        patterns,
        location: 'packages/@livestore/__workspace__',
      }),
    ],
    dedupePeerDependents: true,
    publicHoistPattern: ['react', 'react-dom', 'react-reconciler'],
  })

/**
 * pnpm workspace for Expo/React Native packages.
 * Hoists React Native related packages to prevent bundler issues.
 *
 * @param patterns - Direct workspace dependency paths
 */
export const pnpmWorkspaceExpo = (...patterns: string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveLivestoreWorkspacePatterns({
        patterns,
        location: 'packages/@livestore/__workspace__',
      }),
    ],
    dedupePeerDependents: true,
    publicHoistPattern: ['react', 'react-dom', 'react-reconciler', 'react-native', 'expo', 'expo-*'],
  })

/**
 * pnpm workspace for test packages at tests/<name>/.
 * Uses package.json dependency traversal instead of globs to avoid
 * overlapping workspace symlink conflicts between test workspaces.
 *
 * @param packageNames - Direct @livestore package short names (e.g., 'common', 'utils')
 * @param extraPackages - Additional non-@livestore workspace paths
 */
export const pnpmWorkspaceTests = (packageNames: readonly string[], extraPackages?: readonly string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveWorkspacePaths({
        packageNames: resolveTransitiveWorkspacePackageNames(
          packageNames
            .map((name) => `@livestore/${name}`)
            .filter((name): name is WorkspacePackageName => isWorkspacePackageName(name)),
        ),
        location: 'tests/__workspace__',
      }),
      ...(extraPackages ?? []),
    ],
    dedupePeerDependents: true,
  })

/**
 * pnpm workspace for test packages that need React hoisting.
 * Uses package.json dependency traversal instead of globs.
 *
 * @param packageNames - Direct @livestore package short names
 * @param extraPackages - Additional non-@livestore workspace paths
 */
export const pnpmWorkspaceTestsReact = (packageNames: readonly string[], extraPackages?: readonly string[]) =>
  pnpmWorkspaceYaml({
    packages: [
      '.',
      ...resolveWorkspacePaths({
        packageNames: resolveTransitiveWorkspacePackageNames(
          packageNames
            .map((name) => `@livestore/${name}`)
            .filter((name): name is WorkspacePackageName => isWorkspacePackageName(name)),
        ),
        location: 'tests/__workspace__',
      }),
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
  bashShellDefaults,
  namespaceRunner as namespaceRunnerBase,
  runDevenvTasksBefore,
  installNixStep,
  cachixStep,
  installMegarepoStep,
  syncMegarepoStep,
  installDevenvFromLockStep,
  validateNixStoreStep,
  checkoutStep,
} from '../repos/effect-utils/genie/ci-workflow.ts'

export const devenvShellDefaults = {
  run: { shell: 'devenv shell bash -- -e {0}' },
} as const
export { bashShellDefaults }
export { runDevenvTasksBefore }

export const namespaceRunner = (runId: string) => namespaceRunnerBase('namespace-profile-linux-x86-64', runId)

/**
 * Setup steps for livestore CI jobs (without checkout).
 * Uses shared step atoms from effect-utils/genie/ci-workflow.ts.
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
