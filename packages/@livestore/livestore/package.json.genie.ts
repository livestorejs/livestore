import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/livestore',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
    './internal': './src/internal/mod.ts',
    './internal/testing-utils': './src/utils/tests/mod.ts',
    './effect': './src/effect/mod.ts',
  },
  dependencies: { ...catalog.pick('@livestore/common', '@livestore/utils', '@opentelemetry/api') },
  peerDependencies: utilsPkg.data.peerDependencies,
  devDependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/utils-dev',
      '@opentelemetry/sdk-trace-base',
      'jsdom',
      'typescript',
      'vite',
      'vitest',
    ),
  },
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
