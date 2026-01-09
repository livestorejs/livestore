import { localPackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@local/shared',
  exports: {
    '.': './src/index.ts',
  },
  devDependencies: ['@types/node'],
  ...localPackageDefaults,
})
