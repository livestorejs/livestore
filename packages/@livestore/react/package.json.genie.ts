import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/react',
  exports: {
    '.': './src/mod.ts',
    './experimental': './src/experimental/mod.ts',
  },
  dependencies: ['@livestore/common', '@livestore/livestore', '@livestore/utils', '@opentelemetry/api'],
  devDependencies: [
    '@livestore/adapter-web',
    '@livestore/utils-dev',
    '@opentelemetry/sdk-trace-base',
    '@testing-library/dom',
    '@testing-library/react',
    '@types/react',
    '@types/react-dom',
    'jsdom',
    'react',
    'react-dom',
    'react-window',
    'typescript',
    'vite',
    'vitest',
  ],
  peerDependencies: {
    react: '^19.1.0',
  },
  ...livestorePackageDefaults,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './experimental': './dist/experimental/mod.js',
    },
  },
  scripts: {
    build: 'tsc',
    test: 'vitest && REACT_STRICT_MODE=1 vitest',
  },
})
