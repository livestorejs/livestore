import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/graphql',
  exports: {
    '.': './src/index.ts',
  },
  dependencies: [
    '@graphql-typed-document-node/core',
    '@livestore/common',
    '@livestore/livestore',
    '@livestore/utils',
    '@opentelemetry/api',
  ],
  devDependencies: ['graphql'],
  peerDependencies: {
    graphql: '^16.11.0',
  },
  ...livestorePackageDefaults,
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
