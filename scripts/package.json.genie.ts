import docsPkg from '../docs/package.json.genie.ts'
import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../genie/repo.ts'
import commonPkg from '../packages/@livestore/common/package.json.genie.ts'
import utilsDevPkg from '../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../packages/@livestore/utils/package.json.genie.ts'
import astroTldrawPkg from '../packages/@local/astro-tldraw/package.json.genie.ts'
import astroTwoslashCodePkg from '../packages/@local/astro-twoslash-code/package.json.genie.ts'
import sharedPkg from '../packages/@local/shared/package.json.genie.ts'
import testsIntegrationPkg from '../tests/integration/package.json.genie.ts'
import testsPackageCommonPkg from '../tests/package-common/package.json.genie.ts'
import testsSyncProviderPkg from '../tests/sync-provider/package.json.genie.ts'

const composition = catalog.compose({
  workspace: workspaceMember('scripts', {
    extraMemberPaths: ['docs/src/content/_assets/code'],
  }),
  devDependencies: {
    workspace: [
      commonPkg,
      utilsPkg,
      utilsDevPkg,
      sharedPkg,
      astroTldrawPkg,
      astroTwoslashCodePkg,
      docsPkg,
      testsIntegrationPkg,
      testsPackageCommonPkg,
      testsSyncProviderPkg,
    ],
    external: {
      ...effectDevDeps('@types/node', 'typescript', 'vitest'),
      '@types/bun': '1.3.10',
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
  composition,
)
