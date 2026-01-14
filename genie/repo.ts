/**
 * LiveStore monorepo configuration
 *
 * Extends effect-utils catalog with livestore-specific packages.
 * Uses genie from @overeng/genie for config file generation.
 */

import {
  defineCatalog,
  packageJson,
  tsconfigJson,
  dotdotConfig,
  workspaceRoot,
} from '../../@overeng/genie/src/runtime/mod.ts'

export { tsconfigJson, dotdotConfig, packageJson, workspaceRoot }

import {
  catalog as effectUtilsCatalog,
  baseTsconfigCompilerOptions,
  domLib,
  reactJsx,
} from '../../effect-utils/genie/external.ts'

export { baseTsconfigCompilerOptions, domLib, reactJsx }

/**
 * Internal workspace packages with file: paths.
 * These are resolved to relative paths at stringify time by genie.
 */
const workspaceCatalog = {
  // @livestore/* packages
  '@livestore/utils': 'file:packages/@livestore/utils',
  '@livestore/utils-dev': 'file:packages/@livestore/utils-dev',
  '@livestore/common': 'file:packages/@livestore/common',
  '@livestore/common-cf': 'file:packages/@livestore/common-cf',
  '@livestore/livestore': 'file:packages/@livestore/livestore',
  '@livestore/react': 'file:packages/@livestore/react',
  '@livestore/solid': 'file:packages/@livestore/solid',
  '@livestore/svelte': 'file:packages/@livestore/svelte',
  '@livestore/adapter-web': 'file:packages/@livestore/adapter-web',
  '@livestore/adapter-node': 'file:packages/@livestore/adapter-node',
  '@livestore/adapter-expo': 'file:packages/@livestore/adapter-expo',
  '@livestore/adapter-cloudflare': 'file:packages/@livestore/adapter-cloudflare',
  '@livestore/sqlite-wasm': 'file:packages/@livestore/sqlite-wasm',
  '@livestore/webmesh': 'file:packages/@livestore/webmesh',
  '@livestore/devtools-web-common': 'file:packages/@livestore/devtools-web-common',
  '@livestore/devtools-expo': 'file:packages/@livestore/devtools-expo',
  '@livestore/graphql': 'file:packages/@livestore/graphql',
  '@livestore/sync-cf': 'file:packages/@livestore/sync-cf',
  '@livestore/sync-s2': 'file:packages/@livestore/sync-s2',
  '@livestore/sync-electric': 'file:packages/@livestore/sync-electric',
  '@livestore/cli': 'file:packages/@livestore/cli',
  '@livestore/effect-playwright': 'file:packages/@livestore/effect-playwright',
  '@livestore/peer-deps': 'file:packages/@livestore/peer-deps',
  '@livestore/wa-sqlite': 'file:packages/@livestore/wa-sqlite',

  // @local/* packages (internal tooling)
  '@local/astro-tldraw': 'file:packages/@local/astro-tldraw',
  '@local/astro-twoslash-code': 'file:packages/@local/astro-twoslash-code',
  '@local/shared': 'file:packages/@local/shared',
} as const

/** LiveStore-specific packages not in effect-utils catalog */
const livestoreOnlyCatalog = {
  // Published @livestore packages (not workspace packages)
  '@livestore/devtools-vite': '0.4.0-dev.22',

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

  // Additional OpenTelemetry packages
  '@opentelemetry/context-zone': '2.2.0',
  '@opentelemetry/core': '2.2.0',
  '@opentelemetry/exporter-metrics-otlp-grpc': '0.208.0',
  '@opentelemetry/exporter-metrics-otlp-http': '0.208.0',
  '@opentelemetry/exporter-trace-otlp-grpc': '0.208.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.208.0',
  '@opentelemetry/otlp-exporter-base': '0.208.0',
  '@opentelemetry/otlp-transformer': '0.208.0',
  '@opentelemetry/resources': '2.2.0',
  '@opentelemetry/sdk-metrics': '2.2.0',
  '@opentelemetry/sdk-trace-base': '2.2.0',
  '@opentelemetry/sdk-trace-node': '2.2.0',
  '@opentelemetry/sdk-trace-web': '2.2.0',
  '@opentelemetry/semantic-conventions': '1.38.0',

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
  '@biomejs/biome': '2.3.8',
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
// Root Package Config Exports (for parent repo composition)
// =============================================================================

/** PNPM patched dependencies (paths relative to livestore repo root) */
export const patchedDependencies = {
  'knip@5.80.0': 'patches/knip@5.80.0.patch',
  'starlight-contextual-menu@0.1.3': 'patches/starlight-contextual-menu@0.1.3.patch',
  'starlight-markdown@0.1.5': 'patches/starlight-markdown@0.1.5.patch',
} as const

/** PNPM overrides for version alignment */
export const overrides = {
  puppeteer: '23.11.1',
} as const

/** Packages that should only be built (not hoisted) */
export const onlyBuiltDependencies = [
  '@mixedbread/cli',
  '@parcel/watcher',
  '@tailwindcss/oxide',
  'dtrace-provider',
  'esbuild',
  'msgpackr-extract',
  'protobufjs',
  'sharp',
  'workerd',
] as const

/** Workspace package resolutions for parent repo composition */
export const workspaceResolutions = {
  '@livestore/adapter-cloudflare': 'workspace:*',
  '@livestore/adapter-expo': 'workspace:*',
  '@livestore/adapter-node': 'workspace:*',
  '@livestore/adapter-web': 'workspace:*',
  '@livestore/cli': 'workspace:*',
  '@livestore/common': 'workspace:*',
  '@livestore/devtools-expo': 'workspace:*',
  '@livestore/devtools-vite': '0.4.0-dev.22',
  '@livestore/devtools-web-common': 'workspace:*',
  '@livestore/livestore': 'workspace:*',
  '@livestore/peer-deps': 'workspace:*',
  '@livestore/react': 'workspace:*',
  '@livestore/solid': 'workspace:*',
  '@livestore/sqlite-wasm': 'workspace:*',
  '@livestore/svelte': 'workspace:*',
  '@livestore/sync-cf': 'workspace:*',
  '@livestore/sync-electric': 'workspace:*',
  '@livestore/sync-s2': 'workspace:*',
  '@livestore/utils': 'workspace:*',
  '@livestore/utils-dev': 'workspace:*',
  '@livestore/wa-sqlite': 'workspace:*',
  '@livestore/webmesh': 'workspace:*',
} as const

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
// TypeScript Configuration Helpers
// =============================================================================

/**
 * LiveStore base TypeScript compiler options.
 * Uses ESNext target for maximum modern syntax support.
 * NodeNext module resolution for proper ESM handling.
 *
 * Effect Language Service plugin configuration:
 * - reportSuggestionsAsWarningsInTsc: show suggestions in tsc output
 * - pipeableMinArgCount: 2 - recommend pipe() for 2+ args
 * - schemaUnionOfLiterals: warning - prefer Schema.Literal union
 */
export const livestoreBaseTsconfigCompilerOptions = {
  paths: {
    '#genie/*': ['../@overeng/genie/src/runtime/*'],
  },
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  esModuleInterop: true,
  sourceMap: true,
  declarationMap: true,
  declaration: true,
  strictNullChecks: true,
  incremental: true,
  composite: true,
  allowJs: true,
  stripInternal: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  noFallthroughCasesInSwitch: true,
  noErrorTruncation: true,
  isolatedModules: true,
  target: 'ESNext' as const,
  module: 'NodeNext' as const,
  moduleResolution: 'NodeNext' as const,
  verbatimModuleSyntax: true,
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: true,
  erasableSyntaxOnly: true,
  plugins: [
    {
      name: '@effect/language-service',
      reportSuggestionsAsWarningsInTsc: true,
      pipeableMinArgCount: 2,
      diagnosticSeverity: {
        schemaUnionOfLiterals: 'warning',
      },
    },
  ],
} as const

/** Standard exclude patterns for tsconfig */
export const tsconfigExclude = ['packages/**/dist', 'node_modules', 'packages/**/node_modules', 'tests/**/node_modules']

/** Standard package tsconfig compiler options (composite mode with src/dist structure) */
export const packageTsconfigCompilerOptions = {
  rootDir: './src',
  outDir: './dist',
  tsBuildInfoFile: './dist/.tsbuildinfo',
} as const

/** Solid JSX configuration */
export const solidJsx = { jsx: 'preserve' as const, jsxImportSource: 'solid-js' }

// =============================================================================
// GitHub Workflow Helpers
// =============================================================================

export { githubWorkflow } from '../../@overeng/genie/src/runtime/mod.ts'

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
