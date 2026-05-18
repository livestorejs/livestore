import { catalog, effectDevDeps, packageJson, workspaceMember } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/effect-playwright'),
  dependencies: {
    workspace: [utilsPkg],
  },
  devDependencies: {
    external: effectDevDeps('@playwright/test', '@types/node'),
  },
  peerDependencies: {
    external: {
      '@playwright/test': '^1.56.0',
    },
  },
})

export default packageJson(
  {
    name: '@livestore/effect-playwright',
    version: '0.0.0',
    type: 'module',
    private: true,
    exports: {
      '.': './src/index.ts',
    },
    scripts: {
      test: "echo 'No tests'",
    },
  },
  runtimeDeps,
)
