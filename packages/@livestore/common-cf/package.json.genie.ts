import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/common-cf',
  ...livestorePackageDefaults,
  exports: {
    '.': './src/mod.ts',
    './declare': './src/declare/mod.ts',
  },
  dependencies: { ...catalog.pick('@cloudflare/workers-types', '@livestore/utils') },
  devDependencies: { ...catalog.pick('@livestore/utils-dev', 'vitest', 'wrangler') },
  files: [...livestorePackageDefaults.files, 'README.md'],
  publishConfig: {
    access: 'public',
    exports: {
      '.': './dist/mod.js',
      './declare': './dist/declare/mod.js',
    },
  },
  scripts: {
    test: 'vitest run',
  },
})
