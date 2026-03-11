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
    external: {
      ...catalog.pick(
        '@opentelemetry/sdk-trace-base',
        '@solidjs/testing-library',
        'jsdom',
        'solid-js',
        'typescript',
        'vite',
        'vitest',
      ),
      'vite-plugin-solid': '2.11.10',
      ...catalog.pick('@testing-library/jest-dom'),
    },
  },
})

export default packageJson(
  {
    name: '@livestore/solid',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
    },
    peerDependencies: {
      ...utilsPkg.data.peerDependencies,
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
  },
  {
    composition: runtimeDeps,
  },
)
