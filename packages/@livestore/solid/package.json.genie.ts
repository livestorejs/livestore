import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/solid',
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: ['@livestore/common', '@livestore/livestore', '@livestore/utils', '@opentelemetry/api'],
  devDependencies: ['@opentelemetry/sdk-trace-base', 'jsdom', 'solid-js', 'typescript', 'vite', 'vitest'],
  peerDependencies: {
    'solid-js': '^1.9.10',
  },
  ...livestorePackageDefaults,
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
