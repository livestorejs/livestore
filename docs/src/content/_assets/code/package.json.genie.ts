import { catalog, packageJson } from '../../../../../genie/repo.ts'
import utilsPkg from '../../../../../packages/@livestore/utils/package.json.genie.ts'

export default packageJson({
  name: 'docs-code-snippets',
  version: '0.0.0',
  type: 'module',
  private: true,
  dependencies: {
    // Upstream peer deps spread into dependencies (leaf node pattern)
    ...utilsPkg.data.peerDependencies,
    ...catalog.pick('svelte', 'expo-application', 'expo-sqlite'),

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
      '@livestore/utils',
    ),

    // Published @livestore packages (from catalog)
    ...catalog.pick('@livestore/devtools-vite'),

    // Cloudflare types (from catalog)
    ...catalog.pick('@cloudflare/workers-types'),

    // OpenTelemetry (from catalog)
    ...catalog.pick(
      '@opentelemetry/context-zone',
      '@opentelemetry/core',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-web',
    ),

    // TanStack (doc-specific version, not from catalog)
    '@tanstack/react-router': '1.139.14',

    // Types (from catalog)
    ...catalog.pick('@types/node'),

    // Vue (doc-specific, not from catalog)
    '@vitejs/plugin-vue': '6.0.0',

    // Effect (from catalog)
    ...catalog.pick('effect'),

    // Vite (from catalog) - needed for vite/client types
    ...catalog.pick('vite'),

    // Expo (doc-specific, not from catalog)
    expo: '54.0.12',
    'expo-status-bar': '3.0.8',

    // Misc doc-specific deps
    'fractional-indexing': '3.2.0',
    jose: '6.1.0',

    // React (from catalog)
    ...catalog.pick('react', 'react-dom'),

    // React error boundary (doc-specific)
    'react-error-boundary': '6.0.0',

    // React Native (doc-specific)
    'react-native': '0.81.4',

    // SolidJS (from catalog)
    ...catalog.pick('solid-js'),

    // Vue (doc-specific)
    'vite-plugin-vue-devtools': '7.7.9',
    'vue-livestore': '0.2.3',
  },
})
