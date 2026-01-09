import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/svelte',
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: ['@livestore/common', '@livestore/livestore', '@livestore/utils', '@opentelemetry/api'],
  devDependencies: [
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
  ],
  peerDependencies: {
    svelte: '^5.31.0',
  },
  ...livestorePackageDefaults,
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
