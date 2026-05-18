import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonCfPkg from '../common-cf/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import sqliteWasmPkg from '../sqlite-wasm/package.json.genie.ts'
import syncCfPkg from '../sync-cf/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/adapter-cloudflare'),
  dependencies: {
    workspace: [commonPkg, commonCfPkg, livestorePkg, sqliteWasmPkg, syncCfPkg, utilsPkg],
    external: catalog.pick('@cloudflare/workers-types'),
  },
  devDependencies: {
    external: catalog.pick('wrangler'),
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
  },
})

export default packageJson(
  {
    name: '@livestore/adapter-cloudflare',
    ...livestorePackageDefaults,
    sideEffects: ['./src/polyfill.ts', './dist/polyfill.js'],
    exports: {
      '.': './src/mod.ts',
      './polyfill': './src/polyfill.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
        './polyfill': './dist/polyfill.js',
      },
    },
    scripts: {
      test: 'echo No tests yet',
    },
  },
  runtimeDeps,
)
