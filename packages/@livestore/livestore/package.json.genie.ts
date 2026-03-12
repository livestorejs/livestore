import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import adapterWebPkg from '../adapter-web/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [adapterWebPkg, utilsDevPkg],
    external: catalog.pick('@opentelemetry/sdk-trace-base', 'jsdom', 'typescript', 'vite', 'vitest'),
  },
})

export default packageJson(
  {
    name: '@livestore/livestore',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './internal': './src/internal/mod.ts',
      './internal/testing-utils': './src/utils/tests/mod.ts',
      './effect': './src/effect/mod.ts',
    },
    peerDependencies: utilsPkg.data.peerDependencies,
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
  },
  runtimeDeps,
)
