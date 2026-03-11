import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [utilsPkg],
    external: catalog.pick('@cloudflare/workers-types'),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick('vitest', 'wrangler'),
  },
})

export default packageJson(
  {
    name: '@livestore/common-cf',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/mod.ts',
      './declare': './src/declare/mod.ts',
    },
    peerDependencies: utilsPkg.data.peerDependencies,
    files: [...livestorePackageDefaults.files, 'README.md'],
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/mod.js',
        './declare': './dist/declare/mod.js',
      },
    },
    scripts: {
      test: 'vitest run',
    },
  },
  {
    composition: runtimeDeps,
  },
)
