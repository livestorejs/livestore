/**
 * LiveStore monorepo configuration
 *
 * Extends effect-utils catalog with livestore-specific packages.
 * The pnpm-workspace.yaml is generated from this file via Genie.
 */

import { createPackageJson } from '../submodules/effect-utils/packages/@overeng/genie/src/lib/mod.ts'
import {
  catalog as effectUtilsCatalog,
  baseTsconfigCompilerOptions,
} from '../submodules/effect-utils/genie/repo.ts'

export { baseTsconfigCompilerOptions }

/** LiveStore-specific packages not in effect-utils catalog */
const livestoreOnlyCatalog = {
  // Additional type packages
  '@types/chrome': '0.1.4',
  '@types/bun': '1.2.21',
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
  '@effect/ai-openai': '0.36.0',
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
  'astro-expressive-code': '0.40.1',
  'expressive-code': '0.40.2',
  'expressive-code-twoslash': '0.4.0',
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
  syncpack: '13.0.4',
  yaml: '2.8.1',
} as const

/** Composed catalog - effect-utils base + livestore-specific */
export const catalog = {
  ...effectUtilsCatalog,
  ...livestoreOnlyCatalog,
} as const

/** Workspace package patterns for type-safe package.json generation */
export const workspacePackagePatterns = [
  '@livestore/*',
  '@local/*',
  '@overeng/*',
] as const

/** Type-safe package.json builder */
export const pkg = createPackageJson({
  catalog,
  workspacePackages: workspacePackagePatterns,
})

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

export { tsconfigJSON } from '../submodules/effect-utils/packages/@overeng/genie/src/lib/mod.ts'

/** Standard package tsconfig compiler options (composite mode with src/dist structure) */
export const packageTsconfigCompilerOptions = {
  rootDir: './src',
  outDir: './dist',
  tsBuildInfoFile: './dist/.tsbuildinfo',
} as const

/** DOM library set for browser-compatible packages */
export const domLib = ['ES2022', 'DOM', 'DOM.Iterable'] as const

/** React JSX configuration */
export const reactJsx = { jsx: 'react-jsx' as const }

/** Solid JSX configuration */
export const solidJsx = { jsx: 'preserve' as const, jsxImportSource: 'solid-js' }

// =============================================================================
// GitHub Workflow Helpers
// =============================================================================

export { githubWorkflow } from '../submodules/effect-utils/packages/@overeng/genie/src/lib/mod.ts'

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
