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
  dotdotConfig,
  oxlintConfig,
  oxfmtConfig,
} from '../repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

export { tsconfigJson, dotdotConfig, packageJson, oxlintConfig, oxfmtConfig }

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
 * Internal workspace packages with link: paths.
 * link: creates symlinks to the original package (no copy in .pnpm/).
 * This avoids TypeScript TS2742 errors caused by file: protocol copying source files.
 * These are resolved to relative paths at stringify time by genie.
 */
const workspaceCatalog = {
  // @livestore/* packages
  '@livestore/utils': 'link:packages/@livestore/utils',
  '@livestore/utils-dev': 'link:packages/@livestore/utils-dev',
  '@livestore/common': 'link:packages/@livestore/common',
  '@livestore/common-cf': 'link:packages/@livestore/common-cf',
  '@livestore/livestore': 'link:packages/@livestore/livestore',
  '@livestore/react': 'link:packages/@livestore/react',
  '@livestore/solid': 'link:packages/@livestore/solid',
  '@livestore/svelte': 'link:packages/@livestore/svelte',
  '@livestore/adapter-web': 'link:packages/@livestore/adapter-web',
  '@livestore/adapter-node': 'link:packages/@livestore/adapter-node',
  '@livestore/adapter-expo': 'link:packages/@livestore/adapter-expo',
  '@livestore/adapter-cloudflare': 'link:packages/@livestore/adapter-cloudflare',
  '@livestore/sqlite-wasm': 'link:packages/@livestore/sqlite-wasm',
  '@livestore/webmesh': 'link:packages/@livestore/webmesh',
  '@livestore/devtools-web-common': 'link:packages/@livestore/devtools-web-common',
  '@livestore/devtools-expo': 'link:packages/@livestore/devtools-expo',
  '@livestore/graphql': 'link:packages/@livestore/graphql',
  '@livestore/sync-cf': 'link:packages/@livestore/sync-cf',
  '@livestore/sync-s2': 'link:packages/@livestore/sync-s2',
  '@livestore/sync-electric': 'link:packages/@livestore/sync-electric',
  '@livestore/cli': 'link:packages/@livestore/cli',
  '@livestore/effect-playwright': 'link:packages/@livestore/effect-playwright',
  '@livestore/framework-toolkit': 'link:packages/@livestore/framework-toolkit',
  '@livestore/peer-deps': 'link:packages/@livestore/peer-deps',
  '@livestore/wa-sqlite': 'link:packages/@livestore/wa-sqlite',

  // @local/* packages (internal tooling)
  '@local/astro-tldraw': 'link:packages/@local/astro-tldraw',
  '@local/astro-twoslash-code': 'link:packages/@local/astro-twoslash-code',
  '@local/oxc-config': 'link:packages/@local/oxc-config',
  '@local/shared': 'link:packages/@local/shared',
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

/** Composed catalog - effect-utils base + livestore-specific + workspace packages */
export const catalog = defineCatalog({
  extends: effectUtilsCatalog,
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
  version: '0.4.0-dev.22',
  type: 'module' as const,
  sideEffects: false as const,
  license: 'Apache-2.0' as const,
  files: ['dist', 'package.json', 'src'],
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
  [
    'namespace-profile-linux-x86-64',
    `namespace-features:github.run-id=${runId}`,
  ] as const

/** Standard devenv shell for CI jobs */
export const devenvShellDefaults = {
  run: { shell: 'devenv shell bash -- -e {0}' },
} as const

/** Standard setup steps for livestore CI jobs */
export const livestoreSetupSteps = [
  { uses: 'actions/checkout@v4' },
  { name: 'Set up environment', uses: './.github/actions/setup-env' },
] as const

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
