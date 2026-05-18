import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import adapterWebPkg from '../adapter-web/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/framework-toolkit'),
  dependencies: {
    workspace: [adapterWebPkg, commonPkg, livestorePkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick('typescript'),
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
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
