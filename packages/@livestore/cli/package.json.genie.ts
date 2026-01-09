import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/cli',
  exports: {
    '.': './src/mod.ts',
  },
  bin: {
    livestore: './src/bin.ts',
  },
  dependencies: [
    '@effect/ai',
    '@effect/ai-openai',
    '@effect/experimental',
    '@effect/opentelemetry',
    '@effect/platform',
    '@effect/rpc',
    '@livestore/adapter-node',
    '@livestore/common',
    '@livestore/livestore',
    '@livestore/peer-deps',
    '@livestore/utils',
    'effect',
  ],
  devDependencies: ['@livestore/utils-dev', '@types/node', 'typescript'],
  ...livestorePackageDefaults,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
    },
    bin: {
      livestore: './dist/bin.js',
    },
  },
  scripts: {
    build: 'tsc',
    dev: 'bun src/bin.ts',
  },
})
