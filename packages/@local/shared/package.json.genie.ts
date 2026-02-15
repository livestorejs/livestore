import { catalog, localPackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@local/shared',
  exports: {
    '.': './src/index.ts',
  },
  devDependencies: {
    ...catalog.pick('@types/node'),
  },
  ...localPackageDefaults,
})
