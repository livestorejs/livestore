import { livestoreBaseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    composite: true,
    rootDir: '.',
    outDir: './dist',
    types: ['node', 'astro'],
  },
  include: ['src', 'tests', 'examples'],
  exclude: [...packageTsconfigExclude, 'dist'],
})
