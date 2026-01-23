import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    composite: true,
    rootDir: '.',
    outDir: './dist',
    types: ['node', 'astro'],
  },
  include: ['src', 'tests', 'examples'],
  exclude: [...packageTsconfigExclude, 'dist'],
})
