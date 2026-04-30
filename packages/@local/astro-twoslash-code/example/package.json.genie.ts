import { catalog, effectDevDeps, localPackageDefaults, packageJson, workspaceMember } from '../../../../genie/repo.ts'
import utilsPkg from '../../../@livestore/utils/package.json.genie.ts'
import astroTwoslashCodePkg from '../package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@local/astro-twoslash-code/example'),
  dependencies: {
    workspace: [astroTwoslashCodePkg, utilsPkg],
    external: catalog.pick(
      '@astrojs/starlight',
      'astro',
      'astro-expressive-code',
      'expressive-code-twoslash',
      'expressive-code',
    ),
  },
  devDependencies: {
    external: effectDevDeps('@playwright/test', '@tailwindcss/vite', '@types/node', 'tailwindcss', 'typescript'),
  },
})

export default packageJson(
  {
    name: '@local/astro-twoslash-code-demo',
    scripts: {
      build: 'astro build',
      dev: 'astro dev',
      preview: 'astro preview',
      'snippets:build': 'bun run scripts/build-snippets.ts',
      test: 'bun run snippets:build && bun run playwright test',
    },
    ...localPackageDefaults,
  },
  runtimeDeps,
)
