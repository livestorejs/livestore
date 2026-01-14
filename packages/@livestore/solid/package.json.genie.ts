import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/solid',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: {
    ...catalog.pick('@livestore/common', '@livestore/livestore', '@livestore/utils', '@opentelemetry/api'),
  },
  devDependencies: {
    ...catalog.pick('@opentelemetry/sdk-trace-base', 'jsdom', 'solid-js', 'typescript', 'vite', 'vitest'),
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
