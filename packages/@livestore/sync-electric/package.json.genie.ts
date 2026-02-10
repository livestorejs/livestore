import { catalog, livestorePackageDefaults, packageJson, utilsEffectPeerDeps } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

export default packageJson({
  name: '@livestore/sync-electric',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/index.ts',
  },
  dependencies: { ...catalog.pick('@livestore/common', '@livestore/utils') },
  devDependencies: {
    ...catalog.pick(...utilsEffectPeerDeps),
  },
  peerDependencies: utilsPkg.data.peerDependencies,
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/index.js',
    },
  },
  scripts: {
    build: '',
    test: "echo 'No tests yet'",
  },
})
