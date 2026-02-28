import { catalog, localPackageDefaults, packageJson } from '../../../../genie/repo.ts'

export default packageJson({
  name: '@local/astro-twoslash-code-demo',
  dependencies: {
    ...catalog.pick(
      '@astrojs/starlight',
      'astro',
      'astro-expressive-code',
      'expressive-code-twoslash',
      'expressive-code',
    ),

    '@livestore/utils': 'file:../../../@livestore/utils',
    '@local/astro-twoslash-code': 'file:..',
  },
  devDependencies: {
    ...catalog.pick('@playwright/test', '@tailwindcss/vite', '@types/node', 'tailwindcss', 'typescript'),
  },
  scripts: {
    build: 'astro build',
    dev: 'astro dev',
    preview: 'astro preview',
    'snippets:build': 'bun run scripts/build-snippets.ts',
    test: 'bun run snippets:build && bun run playwright test',
  },
  ...localPackageDefaults,
})
