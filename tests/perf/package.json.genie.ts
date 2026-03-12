import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'
import adapterWebPkg from '../../packages/@livestore/adapter-web/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import reactPkg from '../../packages/@livestore/react/package.json.genie.ts'
import utilsDevPkg from '../../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [adapterWebPkg, livestorePkg, reactPkg, utilsPkg, utilsDevPkg],
    external: catalog.pick(
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-web',
      '@playwright/test',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'react',
      'react-dom',
      'typescript',
      'vite',
    ),
  },
  devDependencies: {
    external: effectDevDeps(),
  },
})

export default packageJson(
  {
    name: '@local/tests-perf',
    ...localPackageDefaults,
    scripts: {
      test: 'NODE_OPTIONS=--disable-warning=ExperimentalWarning playwright test',
      'test-app': 'vite build test-app && vite preview test-app',
      'test-app:dev': 'vite test-app',
      'test:profiler': 'PERF_PROFILER=1 pnpm test',
    },
  },
  runtimeDeps,
)
