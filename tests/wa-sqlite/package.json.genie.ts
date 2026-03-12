import { catalog, localPackageDefaults, packageJson, workspaceMember } from '../../genie/repo.ts'
import waSqlitePkg from '../../packages/@livestore/wa-sqlite/package.json.genie.ts'

const composition = catalog.compose({
  workspace: workspaceMember("tests/wa-sqlite"),
  devDependencies: {
    workspace: [waSqlitePkg],
    external: catalog.pick('vitest'),
  },
})

export default packageJson(
  {
    name: '@local/tests-wa-sqlite',
    version: '0.0.54-dev.23',
    type: 'module',
    private: true,
    scripts: {
      test: 'vitest',
    },
  },
  composition,
)
