import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../genie/repo.ts'

export default packageJson({
  name: '@local/scripts',
  ...localPackageDefaults,
  exports: {
    './release': './src/commands/release.ts',
    './docs-export': './src/commands/docs-export.ts',
    './lint': './src/commands/lint.ts',
  },
  devDependencies: {
    // Effect packages - needed to avoid TS2742 errors when types are inferred from
    // workspace dependencies. Scripts must have its own Effect deps, not borrowed from docs.
    ...effectDevDeps(),
    ...catalog.pick(
      '@livestore/common',
      '@livestore/utils',
      '@livestore/utils-dev',
      '@local/astro-tldraw',
      '@local/astro-twoslash-code',
      '@local/docs',
      '@local/tests-integration',
      '@local/tests-sync-provider',
      '@types/node',
      // vitest needed on PATH for test:unit and test:integration commands
      'vitest',
    ),
    '@types/bun': '1.3.5',
    '@types/semver': '^7.7.0',
    knip: '^5.80.0',
    semver: '^7.7.3',
    yaml: '2.8.1',
  },
})
