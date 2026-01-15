import { catalog, localPackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@local/oxc-config',
  exports: {
    './lint.jsonc': './lint.jsonc',
    './fmt.jsonc': './fmt.jsonc',
  },
  devDependencies: {
    ...catalog.pick('@types/node'),
  },
  ...localPackageDefaults,
})
