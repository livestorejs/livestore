import { localPackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@local/shared',
  exports: {
    '.': './src/index.ts',
  },
  devDependencies: ['@types/node'],
  ...localPackageDefaults,
})
