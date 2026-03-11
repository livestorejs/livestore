import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import adapterWebPkg from '../adapter-web/package.json.genie.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, livestorePkg, utilsPkg],
    external: catalog.pick('@opentelemetry/api'),
  },
  devDependencies: {
    workspace: [adapterWebPkg, utilsDevPkg],
    external: catalog.pick(
      '@sveltejs/vite-plugin-svelte',
      '@testing-library/jest-dom',
      '@testing-library/svelte',
      'jsdom',
      'svelte',
      'typescript',
      'vite',
      'vitest',
    ),
  },
})

export default packageJson(
  {
    name: '@livestore/svelte',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
    },
    peerDependencies: {
      ...utilsPkg.data.peerDependencies,
      svelte: '^5.31.0',
    },
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
  },
  {
    composition: runtimeDeps,
  },
)
