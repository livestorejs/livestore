import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  utilsEffectPeerDeps,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'
import webmeshPkg from '../webmesh/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/adapter-expo'),
  dependencies: {
    workspace: [commonPkg, utilsPkg, webmeshPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    external: catalog.pick(...utilsEffectPeerDeps, '@types/node', 'expo-application', 'expo-sqlite', 'react-native'),
  },
  peerDependencies: {
    external: {
      ...getUtilsPeerDeps(),
      'expo-application': '^7.0.7',
      'expo-sqlite': '^16.0.8',
    },
  },
})

export default packageJson(
  {
    name: '@livestore/adapter-expo',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/index.ts',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/index.js',
      },
    },
    scripts: {
      test: 'echo No tests yet',
    },
  },
  runtimeDeps,
)
