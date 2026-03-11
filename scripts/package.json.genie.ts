import docsPkg from '../docs/package.json.genie.ts'
import { catalog, effectDevDeps, localPackageDefaults, packageJson } from '../genie/repo.ts'
import commonPkg from '../packages/@livestore/common/package.json.genie.ts'
import utilsDevPkg from '../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../packages/@livestore/utils/package.json.genie.ts'
import astroTldrawPkg from '../packages/@local/astro-tldraw/package.json.genie.ts'
import astroTwoslashCodePkg from '../packages/@local/astro-twoslash-code/package.json.genie.ts'
import testsIntegrationPkg from '../tests/integration/package.json.genie.ts'
import testsSyncProviderPkg from '../tests/sync-provider/package.json.genie.ts'

const composition = catalog.compose({
  dir: import.meta.dirname,
  devDependencies: {
    workspace: [
      commonPkg,
      utilsPkg,
      utilsDevPkg,
      astroTldrawPkg,
      astroTwoslashCodePkg,
      docsPkg,
      testsIntegrationPkg,
      testsSyncProviderPkg,
    ],
    external: {
      ...effectDevDeps('@types/node', 'vitest'),
      '@types/bun': '1.3.5',
      '@types/semver': '^7.7.0',
      madge: '^8.0.0',
      semver: '^7.7.3',
      yaml: '2.8.1',
    },
  },
})

export default packageJson(
  {
    name: '@local/scripts',
    ...localPackageDefaults,
    exports: {
      './release': './src/commands/release.ts',
      './docs-export': './src/commands/docs-export.ts',
      './lint': './src/commands/lint.ts',
    },
  },
  {
    composition,
  },
)
