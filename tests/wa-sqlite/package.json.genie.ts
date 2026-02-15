import { catalog, localPackageDefaults, packageJson } from '../../genie/repo.ts'

export default packageJson({
  name: '@local/tests-wa-sqlite',
  version: '0.0.54-dev.23',
  type: 'module',
  private: true,
  devDependencies: {
    ...catalog.pick('@livestore/wa-sqlite', 'vitest'),
  },
  scripts: {
    test: 'vitest',
  },
})
