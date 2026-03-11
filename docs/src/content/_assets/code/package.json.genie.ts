import { catalog, packageJson } from '../../../../../genie/repo.ts'
import utilsPkg from '../../../../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  workspace: [utilsPkg],
  external: {
    // External doc-specific runtime deps
    ...catalog.pick('svelte', 'expo-application', 'expo-sqlite'),

    // Published @livestore packages
    ...catalog.pick('@livestore/devtools-vite'),

    // Cloudflare types
    ...catalog.pick('@cloudflare/workers-types'),

    // OpenTelemetry
    ...catalog.pick(
      '@opentelemetry/context-zone',
      '@opentelemetry/core',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-web',
    ),

    // Effect
    ...catalog.pick('effect'),

    // React
    ...catalog.pick('react', 'react-dom'),

    // SolidJS
    ...catalog.pick('solid-js'),

    // Types / tooling
    ...catalog.pick('@types/node', 'vite'),
  },
  mode: 'install',
})

export default packageJson({
  name: 'docs-code-snippets',
  version: '0.0.0',
  type: 'module',
  private: true,
  dependencies: {
    ...runtimeDeps.dependencies,

    // Automerge (not in catalog - doc-specific)
    '@automerge/automerge': '3.2.0',
    '@automerge/react': '2.5.0',

    // Effect Atom (not in catalog - doc-specific)
    '@effect-atom/atom': '0.3.0',
    '@effect-atom/atom-livestore': '0.3.0',
    '@effect-atom/atom-react': '0.3.0',

    // @livestore packages via catalog (uses link: protocol)
    ...catalog.pick(
      '@livestore/adapter-cloudflare',
      '@livestore/adapter-expo',
      '@livestore/adapter-node',
      '@livestore/adapter-web',
      '@livestore/devtools-expo',
      '@livestore/livestore',
      '@livestore/react',
      '@livestore/solid',
      '@livestore/svelte',
      '@livestore/sync-cf',
      '@livestore/sync-electric',
      '@livestore/sync-s2',
    ),

    // TanStack (doc-specific version, not from catalog)
    '@tanstack/react-router': '1.139.14',

    // Vue (doc-specific, not from catalog)
    '@vitejs/plugin-vue': '6.0.0',

    // Expo (doc-specific, not from catalog)
    expo: '54.0.12',
    'expo-status-bar': '3.0.8',

    // Misc doc-specific deps
    'fractional-indexing': '3.2.0',
    jose: '6.1.0',

    // React error boundary (doc-specific)
    'react-error-boundary': '6.0.0',

    // React Native (doc-specific)
    'react-native': '0.81.4',

    // Vue (doc-specific)
    'vite-plugin-vue-devtools': '7.7.9',
    'vue-livestore': '0.2.3',
  },
})
