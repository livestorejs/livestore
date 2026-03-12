import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import adapterWebPkg from '../adapter-web/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [adapterWebPkg, commonPkg, livestorePkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick('typescript'),
  },
})

export default packageJson(
  {
    name: '@livestore/framework-toolkit',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './testing': './src/testing.ts',
    },
    peerDependencies: utilsPkg.data.peerDependencies,
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
        './testing': './dist/testing.js',
      },
    },
    scripts: {
      build: 'tsc',
    },
  },
  runtimeDeps,
)
