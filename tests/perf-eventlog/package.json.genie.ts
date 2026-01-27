import { catalog, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-perf-streaming-loopback',
  ...localPackageDefaults,
  dependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/common',
      '@livestore/livestore',
      '@livestore/react',
      '@livestore/sqlite-wasm',
      '@livestore/utils',
      '@livestore/utils-dev',
      '@opentelemetry/api',
      '@opentelemetry/core',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-web',
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
    ...catalog.pick('@livestore/devtools-vite', '@playwright/test'),
    tsx: '^4.20.0',
  },
  scripts: {
    build: 'pnpm exec vite build --config test-app/vite.config.ts',
    dev: 'pnpm exec vite --config test-app/vite.config.ts',
    preview: 'pnpm exec vite preview --config test-app/vite.config.ts',
    test: 'NODE_OPTIONS=--disable-warning=ExperimentalWarning playwright test',
  },
})
