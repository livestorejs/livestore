import { tsconfigJson } from '../../../../genie/repo.ts'
import { sharedCompilerOptions } from './tsconfig.shared.ts'

export default tsconfigJson({
  compilerOptions: {
    ...sharedCompilerOptions,
    module: 'NodeNext',
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    rootDir: '.',
    outDir: './dist',
    types: ['node'],
    jsx: 'preserve',
    jsxImportSource: 'astro',
  },
  references: [{ path: '..' }, { path: '../../../@livestore/utils' }],
  include: ['astro.config.mjs', 'src', 'scripts', 'tests', 'playwright.config.ts'],
})
