import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import sqliteWasmPkg from '../sqlite-wasm/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'
import webmeshPkg from '../webmesh/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/adapter-node'),
  dependencies: {
    workspace: [commonPkg, sqliteWasmPkg, utilsPkg, webmeshPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    external: catalog.pick(
      '@livestore/devtools-vite',
      '@rollup/plugin-commonjs',
      '@rollup/plugin-node-resolve',
      '@rollup/plugin-terser',
      '@types/node',
      'rollup',
      'vite',
    ),
  },
  peerDependencies: {
    external: {
      ...getUtilsPeerDeps(),
    },
  },
})

export default packageJson(
  {
    name: '@livestore/adapter-node',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/index.ts',
      './devtools': './src/devtools/mod.ts',
      './worker': './src/make-leader-worker.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/index.js',
        './devtools': './dist/devtools/mod.js',
        './worker': './dist/make-leader-worker.js',
      },
    },
    scripts: {
      test: 'echo No tests yet',
    },
  },
  runtimeDeps,
)
