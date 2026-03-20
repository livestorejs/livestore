import { catalog, livestorePackageDefaults, packageJson, utilsEffectPeerDeps, workspaceMember } from '../../../genie/repo.ts'

/** Derives dependencies from the canonical utilsEffectPeerDeps list */
const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/peer-deps'),
  dependencies: {
    external: catalog.pick(...utilsEffectPeerDeps),
  },
})

export default packageJson(
  {
    name: '@livestore/peer-deps',
    ...livestorePackageDefaults,
    description:
      'This is a convenience package that can be installed to satisfy peer dependencies of Livestore packages.',
    files: ['package.json'],
    publishConfig: {
      access: 'public',
    },
    scripts: {
      test: "echo 'No tests for peer-deps'",
    },
  },
  runtimeDeps,
)
