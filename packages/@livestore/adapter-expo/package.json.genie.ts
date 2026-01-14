import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

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
    ...catalog.pick('expo-application', 'expo-sqlite', 'react-native'),
  },
  peerDependencies: {
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
