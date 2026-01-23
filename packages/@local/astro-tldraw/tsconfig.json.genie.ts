import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    rootDir: '.',
    outDir: 'dist',
  },
  include: ['src'],
  exclude: [...packageTsconfigExclude],
})
