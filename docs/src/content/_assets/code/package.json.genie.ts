import { livestoreContribPackageVersions } from '../../../../../genie/external.ts'
import { catalog, packageJson, utilsEffectPeerDeps, workspaceMember } from '../../../../../genie/repo.ts'
import adapterCloudflarePkg from '../../../../../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import adapterWebPkg from '../../../../../packages/@livestore/adapter-web/package.json.genie.ts'
import livestorePkg from '../../../../../packages/@livestore/livestore/package.json.genie.ts'
import reactPkg from '../../../../../packages/@livestore/react/package.json.genie.ts'
import syncCfPkg from '../../../../../packages/@livestore/sync-cf/package.json.genie.ts'
import utilsPkg from '../../../../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('docs/src/content/_assets/code'),
  dependencies: {
    workspace: [adapterCloudflarePkg, adapterWebPkg, livestorePkg, reactPkg, syncCfPkg, utilsPkg],
    external: {
      ...livestoreContribPackageVersions,
      ...catalog.pick(
        ...utilsEffectPeerDeps,
        'svelte',
        'expo-application',
        'expo-sqlite',
        '@cloudflare/workers-types',
        '@opentelemetry/context-zone',
        '@opentelemetry/core',
        '@opentelemetry/exporter-trace-otlp-http',
        '@opentelemetry/sdk-trace-base',
        '@opentelemetry/sdk-trace-web',
        'react',
        'react-dom',
        'solid-js',
        'vite',
        '@livestore/devtools-vite',
        '@tanstack/react-router',
      ),
      '@automerge/automerge': '3.2.0',
      '@automerge/react': '2.5.0',
      '@effect-atom/atom': '0.3.0',
      '@effect-atom/atom-livestore': '0.3.0',
      '@effect-atom/atom-react': '0.3.0',
      '@vitejs/plugin-vue': '6.0.0',
      expo: '54.0.12',
      'expo-status-bar': '3.0.8',
      'fractional-indexing': '3.2.0',
      jose: '6.1.0',
      'react-error-boundary': '6.1.1',
      'react-native': '0.81.4',
      'vite-plugin-vue-devtools': '7.7.9',
      'vue-livestore': '0.2.3',
    },
  },
  devDependencies: {
    external: catalog.pick('@types/node', '@types/react', '@types/react-dom'),
  },
  gvsTypeExtensions: {
    'react-error-boundary': catalog.pick('@types/react', '@types/react-dom'),
  },
  mode: 'install',
})

export default packageJson(
  {
    name: 'docs-code-snippets',
    version: '0.0.0',
    type: 'module',
    private: true,
  },
  runtimeDeps,
)
