import { baseTsconfigCompilerOptions, domLib, packageTsconfigExclude, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    lib: [...domLib],
    composite: true,
    rootDir: '.',
    outDir: './dist',
    types: ['node', 'astro'],
  },
  include: ['src', 'tests', 'examples'],
  exclude: [...packageTsconfigExclude, 'dist', 'src/cli/test-fixtures'],
})
