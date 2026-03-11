import { catalog, localPackageDefaults, packageJson } from '../../../genie/repo.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  devDependencies: {
    external: catalog.pick('@types/node'),
  },
})

export default packageJson(
  {
    name: '@local/shared',
    exports: {
      '.': './src/index.ts',
    },
    ...localPackageDefaults,
  },
  {
    composition: runtimeDeps,
  },
)
