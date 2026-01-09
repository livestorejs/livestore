import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/adapter-expo',
  exports: {
    '.': './src/index.ts',
  },
  dependencies: ['@livestore/common', '@livestore/utils', '@livestore/webmesh', '@opentelemetry/api'],
  devDependencies: ['expo-application', 'expo-sqlite', 'react-native'],
  peerDependencies: {
    'expo-application': '^7.0.7',
    'expo-sqlite': '^16.0.8',
  },
  ...livestorePackageDefaults,
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
