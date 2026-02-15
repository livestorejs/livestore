import { catalog, livestorePackageDefaults, packageJson, utilsEffectPeerDeps } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/adapter-expo',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/index.ts',
  },
  dependencies: {
    ...catalog.pick('@livestore/common', '@livestore/utils', '@livestore/webmesh', '@opentelemetry/api'),
  },
  devDependencies: {
    ...catalog.pick(...utilsEffectPeerDeps, '@types/node', 'expo-application', 'expo-sqlite', 'react-native'),
  },
  peerDependencies: {
    ...utilsPkg.data.peerDependencies,
    'expo-application': '^7.0.7',
    'expo-sqlite': '^16.0.8',
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
})
