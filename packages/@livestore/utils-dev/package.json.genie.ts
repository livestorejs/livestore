import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/utils-dev',
  ...livestorePackageDefaults,
  sideEffects: ['./src/node-vitest/global.ts', './dist/node-vitest/global.js'],
  exports: {
    './node': './src/node/mod.ts',
    './node-vitest': './src/node-vitest/mod.ts',
    './wrangler': './src/wrangler/mod.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@effect/opentelemetry',
      '@effect/vitest',
      '@iarna/toml',
      '@livestore/utils',
      '@opentelemetry/api',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/sdk-metrics',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-node',
      'wrangler',
    ),
  },
  devDependencies: {},
  peerDependencies: {},
  publishConfig: {
    access: 'public',
    exports: {
      './node': './dist/node/mod.js',
      './node-vitest': './dist/node-vitest/mod.js',
      './wrangler': './dist/wrangler/mod.js',
    },
  },
  scripts: {
    test: "echo 'No tests for utils-dev'",
  },
})
