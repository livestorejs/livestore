import { pnpmWorkspace } from '#genie/mod.ts'
import { catalog } from './genie/repo.ts'

export default pnpmWorkspace({
  packages: [
    'scripts',
    'docs',
    'docs/src/content/_assets/code',
    'packages/@livestore/*',
    'packages/@local/*',
    'packages/@local/astro-twoslash-code/example',
    'examples/*',
    'tests/*',
    'submodules/effect-utils/packages/*',
  ],
  catalog,
})
