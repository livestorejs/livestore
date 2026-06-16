/**
 * Stable composition contract for peer repos.
 *
 * Keep this file self-contained (no nested repo imports) so composed megarepos
 * can import it without requiring nested megarepo sync.
 */

import { livestoreCurrentPackageNames, workspaceCatalogForPackageNames } from './repo-topology.ts'

/** Effect v4 packages share one release version; keep LiveStore pins aligned as a single catalog unit. */
export const effectVersion = '4.0.0-beta.83'

export const effectV4Catalog = {
  effect: effectVersion,
  '@effect/ai-openai': effectVersion,
  '@effect/opentelemetry': effectVersion,
  '@effect/platform-browser': effectVersion,
  '@effect/platform-bun': effectVersion,
  '@effect/platform-node': effectVersion,
  '@effect/platform-node-shared': effectVersion,
  '@effect/sql-sqlite-node': effectVersion,
  '@effect/vitest': effectVersion,
} as const

/**
 * effect-utils is still pinned to an Effect v3 catalog. Filter these packages
 * out before catalog composition so generated metadata cannot accidentally
 * reintroduce v3-era peers that v4 moved into `effect` or unstable modules.
 */
export const obsoleteEffectV3Packages = [
  '@effect/ai',
  '@effect/cli',
  '@effect/cluster',
  '@effect/experimental',
  '@effect/platform',
  '@effect/printer',
  '@effect/printer-ansi',
  '@effect/rpc',
  '@effect/sql',
  '@effect/typeclass',
  '@effect/workflow',
] as const

export {
  livestoreCorePackageNames,
  livestoreCurrentPackageNames,
  livestoreEffectUtilsPackageNames,
  livestorePackageTopology,
  materializedMemberPathsForProjection,
  memberPathsForProjection,
  packageDescriptorForPackageName,
  packageDirForPackageName,
  packageJsonNameForPackageName,
  packageNamesForOwner,
  packageNamesForProjection,
  workspaceCatalogForPackageNames,
  workspaceCatalogForProjection,
  type LivestorePackageName,
  type LivestorePackageOwner,
  type LivestorePackageProjection,
  type LivestorePackageTopologyEntry,
} from './repo-topology.ts'

export const livestoreContribPackageJsonNames = [
  '@livestore/adapter-expo',
  '@livestore/adapter-node',
  '@livestore/cli',
  '@livestore/devtools-expo',
  '@livestore/graphql',
  '@livestore/solid',
  '@livestore/svelte',
  '@livestore/sync-electric',
  '@livestore/sync-s2',
] as const

export const livestoreContribPackageVersions = Object.fromEntries(
  livestoreContribPackageJsonNames.map((name) => [name, '0.4.0']),
) as Record<(typeof livestoreContribPackageJsonNames)[number], '0.4.0'>

/** Workspace packages exposed by LiveStore. */
export const livestoreWorkspaceCatalog = {
  ...workspaceCatalogForPackageNames(livestoreCurrentPackageNames),
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

/** LiveStore-only versions not provided by effect-utils base catalog. */
export const livestoreOnlyCatalog = {
  /**
   * LiveStore republishes DevTools artifacts under the LiveStore release version.
   * The source artifact carries its own metadata for artifact lineage and protocol compatibility.
   */
  '@livestore/devtools-vite': process.env.LIVESTORE_RELEASE_VERSION ?? '0.4.0-dev.25',
  /** Tanstack router sub-packages not in effect-utils catalog (react-router/react-start/router-plugin are there) */
  '@tanstack/router-core': '1.145.7',
  '@tanstack/history': '1.145.7',
  '@tanstack/router-devtools': '1.145.7',
  '@tanstack/router-devtools-core': '1.145.7',
  '@tanstack/react-router-devtools': '1.145.7',
  '@tanstack/start-plugin-core': '1.145.7',
  '@tanstack/start-server-core': '1.145.7',
  '@tanstack/start-client-core': '1.145.7',
  '@types/chrome': '0.1.4',
  '@types/web': '0.0.264',
  '@types/hast': '3.0.4',
  '@types/jasmine': '5.1.4',
  '@types/jsdom': '21.1.7',
  '@types/react-window': '1.8.8',
  '@types/wicg-file-system-access': '2023.10.6',
  '@vitest/ui': '3.2.4',
  'solid-js': '1.9.10',
  '@solidjs/testing-library': '0.8.10',
  '@testing-library/dom': '10.4.1',
  '@testing-library/jest-dom': '6.6.3',
  '@testing-library/svelte': '5.3.1',
  '@web/dev-server': '0.4.6',
  '@web/test-runner': '0.20.0',
  '@web/test-runner-core': '0.13.4',
  'jasmine-core': '4.5.0',
  jsdom: '26.1.0',
  'web-test-runner-jasmine': '0.0.6',
  '@opentelemetry/context-zone': '2.2.0',
  '@opentelemetry/core': '2.2.0',
  '@opentelemetry/exporter-metrics-otlp-grpc': '0.208.0',
  '@opentelemetry/exporter-metrics-otlp-http': '0.208.0',
  '@opentelemetry/exporter-trace-otlp-grpc': '0.208.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.208.0',
  '@opentelemetry/otlp-exporter-base': '0.208.0',
  '@opentelemetry/otlp-transformer': '0.208.0',
  graphql: '16.11.0',
  comlink: '4.4.1',
  'react-window': '1.8.11',
  'monaco-editor': '0.34.1',
  nanoid: '5.0.9',
  'pretty-bytes': '7.0.1',
  'qrcode-generator': '2.0.4',
  '@iarna/toml': '3.0.0',
  '@graphql-typed-document-node/core': '3.2.0',
  'astro-expressive-code': '0.43.1',
  'expressive-code': '0.43.1',
  'expressive-code-twoslash': '0.5.3',
  hast: '1.0.0',
  'hast-util-to-html': '9.0.4',
  '@kitschpatrol/tldraw-cli': '5.0.1',
  rollup: '4.49.0',
  '@rollup/plugin-commonjs': '28.0.6',
  '@rollup/plugin-node-resolve': '16.0.1',
  '@rollup/plugin-terser': '0.4.4',
  svelte: '5.43.14',
  '@sveltejs/vite-plugin-svelte': '6.2.1',
  astro: '6.4.6',
  '@astrojs/starlight': '0.40.0',
  typedoc: '0.28.19',
  expo: '54.0.12',
  'expo-application': '7.0.7',
  'expo-sqlite': '16.0.8',
  'react-native': '0.81.4',
  wrangler: '4.42.2',
  '@cloudflare/workers-types': '4.20251118.0',
  husky: '9.1.7',
  madge: '8.0.0',
  yaml: '2.8.1',
} as const

const toCamelCase = (value: string) => value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())

/** Internal refs for consumers that need path mappings to @livestore packages. */
export const createLivestoreRefs = (basePath: string) =>
  Object.fromEntries(livestoreCurrentPackageNames.map((name) => [toCamelCase(name), { path: `${basePath}/${name}` }]))
