import { catalog, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/effect-playwright',
  version: '0.0.0',
  type: 'module',
  private: true,
  exports: {
    '.': './src/index.ts',
  },
  dependencies: { ...catalog.pick('@livestore/utils') },
  devDependencies: { ...catalog.pick('@playwright/test', '@types/node') },
  peerDependencies: {
    '@playwright/test': '^1.56.0',
  },
  scripts: {
    test: "echo 'No tests'",
  },
})
