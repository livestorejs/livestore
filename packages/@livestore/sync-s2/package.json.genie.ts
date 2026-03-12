import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, livestorePkg, utilsPkg],
  },
  devDependencies: {
    external: catalog.pick('vitest'),
  },
})

export default packageJson(
  {
    name: '@livestore/sync-s2',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './s2-proxy-helpers': './src/s2-proxy-helpers.ts',
    },
    peerDependencies: utilsPkg.data.peerDependencies,
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
        './s2-proxy-helpers': './dist/s2-proxy-helpers.js',
      },
    },
    scripts: {
      build: '',
      test: "echo 'No tests yet'",
    },
  },
  runtimeDeps,
)
