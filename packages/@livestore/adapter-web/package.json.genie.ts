import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import devtoolsWebCommonPkg from '../devtools-web-common/package.json.genie.ts'
import sqliteWasmPkg from '../sqlite-wasm/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'
import webmeshPkg from '../webmesh/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/adapter-web'),
  dependencies: {
    workspace: [commonPkg, devtoolsWebCommonPkg, sqliteWasmPkg, utilsPkg, webmeshPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    external: catalog.pick('@types/chrome', '@types/wicg-file-system-access', 'vitest'),
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
  },
})

export default packageJson(
  {
    name: '@livestore/adapter-web',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/index.ts',
      './worker': './src/web-worker/leader-worker/make-leader-worker.ts',
      './worker-vite-dev-polyfill': './src/web-worker/vite-dev-polyfill.ts',
      './shared-worker': './src/web-worker/shared-worker/make-shared-worker.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/index.js',
        './worker': './dist/web-worker/leader-worker/make-leader-worker.js',
        './worker-vite-dev-polyfill': './dist/web-worker/vite-dev-polyfill.js',
        './shared-worker': './dist/web-worker/shared-worker/make-shared-worker.js',
      },
    },
    scripts: {
      test: 'echo No tests yet',
    },
  },
  runtimeDeps,
)
