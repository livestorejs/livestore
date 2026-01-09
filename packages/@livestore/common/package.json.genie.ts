import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/common',
  exports: {
    '.': './src/index.ts',
    './sql-queries': './src/sql-queries/index.ts',
    './leader-thread': './src/leader-thread/mod.ts',
    './schema': './src/schema/mod.ts',
    './sync': './src/sync/index.ts',
    './sync/next': './src/sync/next/mod.ts',
    './sync/next/test': './src/sync/next/test/mod.ts',
    './testing': './src/testing/mod.ts',
  },
  dependencies: ['@livestore/utils', '@livestore/webmesh', '@opentelemetry/api'],
  devDependencies: ['@livestore/utils-dev', 'vitest'],
  ...livestorePackageDefaults,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/index.js',
      './sql-queries': './dist/sql-queries/index.js',
      './leader-thread': './dist/leader-thread/mod.js',
      './schema': './dist/schema/mod.js',
      './sync': './dist/sync/index.js',
      './sync/next': './dist/sync/next/mod.js',
      './sync/next/test': './dist/sync/next/test/mod.js',
      './testing': './dist/testing/mod.js',
    },
  },
  scripts: {
    test: 'vitest',
  },
})
