import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-integration',
  version: '0.0.54-dev.23',
  type: 'module',
  private: true,
  exports: {
    './run-tests': './scripts/run-tests.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/adapter-cloudflare',
      '@livestore/adapter-node',
      '@livestore/adapter-web',
      '@livestore/common',
      '@livestore/common-cf',
      '@livestore/devtools-vite',
      '@livestore/effect-playwright',
      '@livestore/livestore',
      '@livestore/react',
      '@livestore/sync-cf',
      '@livestore/utils',
      '@livestore/utils-dev',
      '@local/shared',
    ),
  },
  devDependencies: {
    ...effectDevDeps(
      '@cloudflare/workers-types',
      '@opentelemetry/api',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-web',
      '@playwright/test',
      '@tanstack/react-router',
      '@tanstack/router-plugin',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      'react',
      'react-dom',
      'vite',
      'vitest',
      'wrangler',
    ),
    'react-error-boundary': '^6.0.0',
    'todomvc-app-css': '^2.4.3',
  },
  scripts: {
    test: 'CI=1 bun ./scripts/run-tests.ts',
  },
})
