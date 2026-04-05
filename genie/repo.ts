import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  baseTsconfigCompilerOptions,
  commonPnpmPolicySettings,
  defineCatalog,
  declarationPathMappingsForPackage,
  domLib,
  githubRuleset,
  githubWorkflow,
  megarepoJson,
  oxfmtConfig,
  oxlintConfig,
  packageTsconfigCompilerOptions as effectUtilsPackageTsconfigCompilerOptions,
  packageJson,
  type PnpmPackageClosureConfig,
  pnpmWorkspaceYaml,
  reactJsx,
  tsconfigJson as externalTsconfigJson,
  type PackageJsonData,
  type PnpmWorkspaceData,
  type WorkspaceIdentity,
  type WorkspaceMeta,
  type WorkspaceMetadata,
  type WorkspacePackage,
  type WorkspacePackageLike,
} from '../repos/effect-utils/genie/external.ts'
import { baseOxfmtIgnorePatterns, baseOxfmtOptions } from '../repos/effect-utils/genie/oxfmt-base.ts'
import { livestoreOnlyCatalog, livestoreWorkspaceCatalog } from './external.ts'

export { baseTsconfigCompilerOptions, domLib, reactJsx }
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

type PackageManifestForPaths = {
  name?: string
  exports?: Record<string, string | Record<string, string>>
  publishConfig?: {
    exports?: Record<string, string | Record<string, string>>
  }
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const walkPackageManifests = (dir: string): string[] => {
  if (existsSync(dir) === false) return []

  const entries = readdirSync(dir, { withFileTypes: true })
  const manifests: string[] = []

  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue
    }

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      manifests.push(...walkPackageManifests(fullPath))
      continue
    }

    if (entry.isFile() && entry.name === 'package.json') {
      manifests.push(fullPath)
    }
  }

  return manifests
}

const localPackageDeclarationMappings = (() => {
  const manifests = [
    ...walkPackageManifests(path.join(repoRoot, 'packages')),
    ...walkPackageManifests(path.join(repoRoot, 'tests')),
    path.join(repoRoot, 'scripts', 'package.json'),
    path.join(repoRoot, 'docs', 'package.json'),
  ]

  const mappings: Record<string, string> = {}

  for (const manifestPath of manifests) {
    if (existsSync(manifestPath) === false) continue

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifestForPaths
    if (manifest.name === undefined || manifest.exports === undefined) continue

    const packageBasePath = path.relative(repoRoot, path.dirname(manifestPath))
    const declarationMappings = declarationPathMappingsForPackage({
      packageName: manifest.name,
      exports: manifest.exports,
      publishConfigExports: manifest.publishConfig?.exports,
      packageBasePath,
    })

    for (const [specifier, [target]] of Object.entries(declarationMappings)) {
      if (target !== undefined) mappings[specifier] = target
    }
  }

  return mappings
})()

const packageNameForLocation = (location: string): string | undefined => {
  const manifestPath = path.join(repoRoot, location, 'package.json')
  if (existsSync(manifestPath) === false) return undefined

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifestForPaths
  return manifest.name
}

const tsconfigPathsForLocation = (location: string): Record<string, string[]> => {
  const depth = location.split('/').filter(Boolean).length
  const toRoot = '../'.repeat(depth)
  const currentPackageName = packageNameForLocation(location)
  const paths: Record<string, string[]> = {}

  for (const [specifier, target] of Object.entries(localPackageDeclarationMappings)) {
    if (
      currentPackageName !== undefined &&
      (specifier === currentPackageName || specifier.startsWith(`${currentPackageName}/`))
    ) {
      continue
    }

    paths[specifier] = [`${toRoot}${target}`]
  }

  return paths
}

export const tsconfigJson = (
  args: Parameters<typeof externalTsconfigJson>[0],
): ReturnType<typeof externalTsconfigJson> => {
  const base = externalTsconfigJson(args)

  return {
    ...base,
    stringify: (ctx) => {
      const compilerOptions = {
        ...args.compilerOptions,
        preserveSymlinks: true,
        baseUrl: args.compilerOptions?.baseUrl ?? '.',
        paths: {
          ...tsconfigPathsForLocation(ctx.location),
          ...args.compilerOptions?.paths,
        },
      }

      return JSON.stringify(
        {
          ...args,
          compilerOptions,
        },
        null,
        2,
      ) + '\n'
    },
  }
}

/**
 * Package tsconfig compiler options for livestore.
 * Uses src/ as rootDir (effect-utils uses . for rootDir).
 */
export const packageTsconfigCompilerOptions = {
  ...effectUtilsPackageTsconfigCompilerOptions,
  rootDir: './src',
  tsBuildInfoFile: './dist/.tsbuildinfo',
  preserveSymlinks: true,
} as const

/**
 * Internal workspace packages using workspace:* protocol.
 *
 * The repo-root pnpm workspace is the authoritative install owner and lockfile
 * source of truth. Package closures are derived from workspace metadata at
 * build time instead of being committed as package-local pnpm-workspace files.
 */

/** Composed catalog - effect-utils base + livestore-specific + workspace packages */
export const catalog = defineCatalog({
  extends: effectUtilsCatalog,
  packages: {
    ...livestoreWorkspaceCatalog,
    ...livestoreOnlyCatalog,
  },
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
// Effect Peer Dependency Helpers
// =============================================================================

/**
 * Peer dependencies for the public @livestore/utils surface.
 * These are the packages that utils exposes types or values from and consumers need.
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
  dispatchAlignmentStep,
  namespaceRunner as namespaceRunnerBase,
  installNixStep,
  cachixStep,
  applyMegarepoLockStep,
  checkoutStep,
  preparePinnedDevenvStep,
  pnpmStoreSetupStep,
  restorePnpmStoreStep,
  runDevenvTasksBefore,
  nixDiagnosticsArtifactStep,
  savePnpmStoreStep,
  validateNixStoreStep,
} from '../repos/effect-utils/genie/ci-workflow.ts'

export const devenvShellDefaults = {
  run: { shell: 'devenv shell bash -- -e {0}' },
} as const
export { bashShellDefaults }
export { dispatchAlignmentStep, runDevenvTasksBefore, nixDiagnosticsArtifactStep, savePnpmStoreStep }

export const namespaceRunner = (runId: string) =>
  namespaceRunnerBase({ profile: 'namespace-profile-linux-x86-64', runId })

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
  applyMegarepoLockStep(),
  preparePinnedDevenvStep,
  pnpmStoreSetupStep,
  restorePnpmStoreStep({ keyPrefix: 'livestore-pnpm-store' }),
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
