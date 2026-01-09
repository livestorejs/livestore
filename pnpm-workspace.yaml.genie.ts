import { catalog } from './genie/repo.ts'
import { pnpmWorkspace } from './submodules/effect-utils/packages/@overeng/genie/src/lib/mod.ts'

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
