import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/sync-s2',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
    './s2-proxy-helpers': './src/s2-proxy-helpers.ts',
  },
  dependencies: { ...catalog.pick('@livestore/common', '@livestore/livestore', '@livestore/utils') },
  peerDependencies: utilsPkg.data.peerDependencies,
  devDependencies: { ...catalog.pick('vitest') },
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './s2-proxy-helpers': './dist/s2-proxy-helpers.js',
    },
  },
  scripts: {
    build: '',
    test: "echo 'No tests yet'",
  },
})
