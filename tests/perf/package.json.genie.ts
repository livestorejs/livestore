import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-perf',
  ...localPackageDefaults,
  dependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/livestore',
      '@livestore/react',
      '@livestore/utils',
      '@livestore/utils-dev',
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
    ...effectDevDeps(),
  },
  scripts: {
    test: 'NODE_OPTIONS=--disable-warning=ExperimentalWarning playwright test',
    'test-app': 'vite build test-app && vite preview test-app',
    'test-app:dev': 'vite test-app',
    'test:profiler': 'PERF_PROFILER=1 pnpm test',
  },
})
