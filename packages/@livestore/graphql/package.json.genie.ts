import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/graphql',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/index.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@graphql-typed-document-node/core',
      '@livestore/common',
      '@livestore/livestore',
      '@livestore/utils',
      '@opentelemetry/api',
    ),
  },
  devDependencies: { ...catalog.pick('graphql') },
  peerDependencies: {
    graphql: '^16.11.0',
  },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/index.js',
    },
  },
  scripts: {
    test: "echo 'No tests'",
  },
})
