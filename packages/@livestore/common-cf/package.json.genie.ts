import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import utilsDevPkg from '../utils-dev/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/common-cf'),
  dependencies: {
    workspace: [utilsPkg],
    external: catalog.pick('@cloudflare/workers-types', 'msgpackr'),
  },
  devDependencies: {
    workspace: [utilsDevPkg],
    external: catalog.pick('vitest', 'wrangler'),
  },
  peerDependencies: {
    external: getUtilsPeerDeps(),
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
  runtimeDeps,
)
