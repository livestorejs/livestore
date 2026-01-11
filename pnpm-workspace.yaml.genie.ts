import { catalog } from './genie/repo.ts'
import { pnpmWorkspace } from './repos/effect-utils/packages/@overeng/genie/src/runtime/mod.ts'

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
    'repos/effect-utils/packages/@overeng/*',
  ],
  catalog,
})
