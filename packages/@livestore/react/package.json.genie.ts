import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/react',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
    './experimental': './src/experimental/mod.ts',
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
    ),
  },
  peerDependencies: {
    ...utilsPkg.data.peerDependencies,
    react: '^19.0.0',
  },
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
