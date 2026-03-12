import { catalog, localPackageDefaults, packageJson, workspaceMember } from '../../../genie/repo.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@local/shared'),
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
  runtimeDeps,
)
