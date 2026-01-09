import { pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/effect-playwright',
  version: '0.0.0',
  type: 'module',
  private: true,
  exports: {
    '.': './src/index.ts',
  },
  dependencies: ['@livestore/utils'],
  devDependencies: ['@playwright/test', '@types/node'],
  peerDependencies: {
    '@playwright/test': '^1.56.0',
  },
  scripts: {
    test: "echo 'No tests'",
  },
})
