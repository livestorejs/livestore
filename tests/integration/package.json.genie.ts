import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../../genie/repo.ts'
import adapterCloudflarePkg from '../../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import adapterNodePkg from '../../packages/@livestore/adapter-node/package.json.genie.ts'
import adapterWebPkg from '../../packages/@livestore/adapter-web/package.json.genie.ts'
import commonCfPkg from '../../packages/@livestore/common-cf/package.json.genie.ts'
import commonPkg from '../../packages/@livestore/common/package.json.genie.ts'
import effectPlaywrightPkg from '../../packages/@livestore/effect-playwright/package.json.genie.ts'
import livestorePkg from '../../packages/@livestore/livestore/package.json.genie.ts'
import reactPkg from '../../packages/@livestore/react/package.json.genie.ts'
import syncCfPkg from '../../packages/@livestore/sync-cf/package.json.genie.ts'
import utilsDevPkg from '../../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../../packages/@livestore/utils/package.json.genie.ts'
import sharedPkg from '../../packages/@local/shared/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember("tests/integration"),
  dependencies: {
    workspace: [
      adapterCloudflarePkg,
      adapterNodePkg,
      adapterWebPkg,
      commonPkg,
      commonCfPkg,
      effectPlaywrightPkg,
      livestorePkg,
      reactPkg,
      syncCfPkg,
      utilsPkg,
      utilsDevPkg,
      sharedPkg,
    ],
    external: catalog.pick('@livestore/devtools-vite'),
  },
  devDependencies: {
    external: {
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
  },
})

export default packageJson(
  {
    name: '@local/tests-integration',
    version: '0.0.54-dev.23',
    type: 'module',
    private: true,
    exports: {
      './run-tests': './scripts/run-tests.ts',
    },
    scripts: {
      test: 'CI=1 bun ./scripts/run-tests.ts',
    },
  },
  runtimeDeps,
)
