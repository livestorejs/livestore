/**
 * LiveStore monorepo configuration - source of truth for catalog versions
 *
 * This file defines all dependency versions used across the monorepo.
 * The pnpm-workspace.yaml is generated from this file via Genie.
 */

/** Catalog versions - single source of truth for dependency versions */
export const catalog = {
  // Type packages
  '@types/react': '19.2.7',
  '@types/react-dom': '19.2.3',
  '@types/node': '25.0.3',
  '@types/chrome': '0.1.4',
  '@types/bun': '1.2.21',
  '@types/web': '0.0.264',

  // Build tools
  typescript: '5.9.3',
  vite: '7.3.0',
  vitest: '4.0.16',
  '@vitest/ui': '3.2.4',
  '@vitejs/plugin-react': '5.1.2',

  // Styling
  tailwindcss: '4.1.18',
  '@tailwindcss/vite': '4.1.18',

  // React ecosystem
  react: '19.2.3',
  'react-dom': '19.2.3',

  // SolidJS ecosystem
  'solid-js': '1.9.10',

  // Testing
  '@playwright/test': '1.57.0',

  // Effect
  '@effect/ai': '0.33.2',
  '@effect/ai-openai': '0.36.0',
  '@effect/cli': '0.73.0',
  '@effect/experimental': '0.58.0',
  effect: '3.19.14',
  '@effect/cluster': '0.56.0',
  '@effect/rpc': '0.73.0',
  '@effect/language-service': '0.63.2',
  '@effect/platform': '0.94.1',
  '@effect/platform-browser': '0.73.0',
  '@effect/platform-bun': '0.86.0',
  '@effect/platform-node': '0.104.0',
  '@effect/platform-node-shared': '0.56.0',
  '@effect/printer': '0.47.0',
  '@effect/printer-ansi': '0.47.0',
  '@effect/opentelemetry': '0.60.0',
  '@effect/sql': '0.49.0',
  '@effect/sql-sqlite-node': '0.49.1',
  '@effect/typeclass': '0.38.0',
  '@effect/vitest': '0.27.0',
  '@effect/workflow': '0.16.0',

  // OpenTelemetry
  '@opentelemetry/api': '1.9.0',
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

  // Cloudflare tools
  wrangler: '4.42.2',
  '@cloudflare/workers-types': '4.20251118.0',
} as const

/** Use catalog reference for dependencies */
export const catalogRef = 'catalog:' as const

/** Root package.json configuration for composition */
export const rootPackageJson = {
  packageManager: 'pnpm@10.17.1',
  devDependencies: {
    '@biomejs/biome': '^2.3.8',
    '@effect/language-service': catalogRef,
    '@overeng/genie': 'workspace:*',
    '@types/node': catalogRef,
    '@vitest/ui': catalogRef,
    husky: '^9.1.7',
    madge: '^8.0.0',
    syncpack: '^13.0.4',
    typescript: catalogRef,
    vite: catalogRef,
    vitest: catalogRef,
    yaml: '^2.8.1',
  },
  pnpm: {
    patchedDependencies: {
      'knip@5.80.0': 'patches/knip@5.80.0.patch',
      'starlight-contextual-menu@0.1.3': 'patches/starlight-contextual-menu@0.1.3.patch',
      'starlight-markdown@0.1.5': 'patches/starlight-markdown@0.1.5.patch',
    },
    onlyBuiltDependencies: [
      '@mixedbread/cli',
      '@parcel/watcher',
      '@tailwindcss/oxide',
      'dtrace-provider',
      'esbuild',
      'msgpackr-extract',
      'protobufjs',
      'sharp',
      'workerd',
    ],
    overrides: {
      puppeteer: '23.11.1',
    },
  },
} as const

/** Workspace package patterns */
export const workspacePackages = [
  'scripts',
  'docs',
  'docs/src/content/_assets/code',
  'packages/@livestore/*',
  'packages/@local/*',
  'packages/@local/astro-twoslash-code/example',
  'examples/*',
  'tests/*',
] as const
