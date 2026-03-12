import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../../genie/repo.ts'
import adapterWebPkg from '../../packages/@livestore/adapter-web/package.json.genie.ts'
import commonPkg from '../../packages/@livestore/common/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import reactPkg from '../../packages/@livestore/react/package.json.genie.ts'
import sqliteWasmPkg from '../../packages/@livestore/sqlite-wasm/package.json.genie.ts'
import utilsDevPkg from '../../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember("tests/perf-eventlog"),
  dependencies: {
    workspace: [
      adapterWebPkg,
      commonPkg,
      livestorePkg,
      reactPkg,
      sqliteWasmPkg,
      utilsPkg,
      utilsDevPkg,
    ],
    external: catalog.pick(
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
    external: {
      ...effectDevDeps('@livestore/devtools-vite', '@playwright/test'),
      tsx: '^4.20.0',
    },
  },
})

export default packageJson(
  {
    name: '@local/tests-perf-streaming-loopback',
    ...localPackageDefaults,
    scripts: {
      build: 'pnpm exec vite build --config test-app/vite.config.ts',
      dev: 'pnpm exec vite --config test-app/vite.config.ts',
      preview: 'pnpm exec vite preview --config test-app/vite.config.ts',
      test: 'NODE_OPTIONS=--disable-warning=ExperimentalWarning playwright test',
    },
  },
  runtimeDeps,
)
