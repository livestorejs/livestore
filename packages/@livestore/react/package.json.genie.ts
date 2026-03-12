import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import adapterWebPkg from '../adapter-web/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import frameworkToolkitPkg from '../framework-toolkit/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, frameworkToolkitPkg, livestorePkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [adapterWebPkg, utilsDevPkg],
    external: catalog.pick(
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
})

export default packageJson(
  {
    name: '@livestore/react',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './experimental': './src/experimental/mod.ts',
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
  },
  runtimeDeps,
)
