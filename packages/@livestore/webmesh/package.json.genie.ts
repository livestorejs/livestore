import { catalog, livestorePackageDefaults, packageJson, utilsEffectPeerDeps } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/webmesh',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
  },
  dependencies: { ...catalog.pick('@livestore/utils') },
  devDependencies: {
    // Include peer deps from utils for local development
    ...catalog.pick(...utilsEffectPeerDeps, '@livestore/utils-dev', 'vitest'),
  },
  // Re-expose utils' peer dependencies
  peerDependencies: utilsPkg.data.peerDependencies,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
    },
  },
  scripts: {
    test: 'vitest',
  },
})
