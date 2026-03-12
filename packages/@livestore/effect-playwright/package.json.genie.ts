import { catalog, effectDevDeps, packageJson } from '../../../genie/repo.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [utilsPkg],
  },
  devDependencies: {
    external: effectDevDeps('@playwright/test', '@types/node'),
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
    peerDependencies: {
      '@playwright/test': '^1.56.0',
    },
    scripts: {
      test: "echo 'No tests'",
    },
  },
  runtimeDeps,
)
