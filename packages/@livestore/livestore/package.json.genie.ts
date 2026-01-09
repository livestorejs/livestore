import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/livestore',
  exports: {
    '.': './src/mod.ts',
    './internal': './src/internal/mod.ts',
    './internal/testing-utils': './src/utils/tests/mod.ts',
    './effect': './src/effect/mod.ts',
  },
  dependencies: ['@livestore/common', '@livestore/utils', '@opentelemetry/api'],
  devDependencies: [
    '@livestore/adapter-web',
    '@livestore/utils-dev',
    '@opentelemetry/sdk-trace-base',
    'jsdom',
    'typescript',
    'vite',
    'vitest',
  ],
  ...livestorePackageDefaults,
  files: [...livestorePackageDefaults.files, 'docs'],
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './internal': './dist/internal/mod.js',
      './internal/testing-utils': './dist/utils/tests/mod.js',
      './effect': './dist/effect/mod.js',
    },
  },
  scripts: {
    build: 'tsc',
    test: 'vitest',
  },
})
