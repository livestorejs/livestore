import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/solid',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: {
    ...catalog.pick(
      '@livestore/common',
      '@livestore/framework-toolkit',
      '@livestore/livestore',
      '@livestore/utils',
      '@opentelemetry/api',
    ),
  },
  devDependencies: {
    ...catalog.pick(
      '@livestore/adapter-web',
      '@livestore/utils-dev',
      '@opentelemetry/sdk-trace-base',
      '@solidjs/testing-library',
      'jsdom',
      'solid-js',
      'typescript',
      'vite',
      'vitest',
    ),
  },
  peerDependencies: {
    'solid-js': '^1.9.10',
  },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
    },
  },
  scripts: {
    build: 'tsc',
    test: "echo 'todo'",
  },
})
