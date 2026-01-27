import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/svelte',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: {
    ...catalog.pick('@livestore/common', '@livestore/livestore', '@livestore/utils', '@opentelemetry/api'),
  },
  devDependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/utils-dev',
      '@sveltejs/vite-plugin-svelte',
      '@testing-library/jest-dom',
      '@testing-library/svelte',
      'jsdom',
      'svelte',
      'typescript',
      'vite',
      'vitest',
    ),
  },
  peerDependencies: {
    svelte: '^5.31.0',
  },
  keywords: ['svelte'],
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
    },
  },
  scripts: {
    build: 'tsc',
    test: 'vitest --config ./tests/vitest.config.ts',
  },
})
