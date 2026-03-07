import { tsconfigJson } from '../../../../genie/repo.ts'
import { sharedCompilerOptions } from './tsconfig.shared.ts'

export default tsconfigJson({
  compilerOptions: {
    ...sharedCompilerOptions,
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    outDir: './dist',
    types: ['node', '@astrojs/astro-types'],
    jsx: 'preserve',
    jsxImportSource: 'astro',
  },
  include: ['astro.config.mjs', 'src', 'scripts', 'tests', 'playwright.config.ts'],
})
