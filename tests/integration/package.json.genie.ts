import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../../genie/repo.ts'
import adapterCloudflarePkg from '../../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
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
  workspace: workspaceMember('tests/integration'),
  dependencies: {
    workspace: [
      adapterCloudflarePkg,
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
      /**
       * Required for `release:devtools-artifact:certify-liveness`: that task
       * `cp -a`-replaces `node_modules/@livestore/devtools-vite` with the
       * repacked artifact, severing it from devtools-vite's own dependency
       * closure (so the `packageExtensions` injection in pnpm-workspace.yaml
       * does not survive). The fixed devtools-vite does a bare
       * `require('@parcel/watcher')`, so the meta package must be resolvable
       * directly from `tests/integration/node_modules/` under pure-pnpm GVS.
       */
      '@parcel/watcher': '^2.5.0',
      'react-error-boundary': '6.1.1',
      'todomvc-app-css': '2.4.3',
    },
  },
  gvsTypeExtensions: {
    'react-error-boundary': catalog.pick('@types/react', '@types/react-dom'),
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
