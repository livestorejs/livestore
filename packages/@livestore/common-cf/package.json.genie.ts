import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/common-cf',
  exports: {
    '.': './src/mod.ts',
    './declare': './src/declare/mod.ts',
  },
  dependencies: ['@cloudflare/workers-types', '@livestore/utils'],
  devDependencies: ['@livestore/utils-dev', 'vitest', 'wrangler'],
  ...livestorePackageDefaults,
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
