import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/framework-toolkit',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
    './testing': './src/testing.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/common',
      '@livestore/livestore',
      '@livestore/utils',
      '@opentelemetry/api',
    ),
  },
  devDependencies: {
    ...catalog.pick('@livestore/utils-dev', 'typescript'),
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
})
