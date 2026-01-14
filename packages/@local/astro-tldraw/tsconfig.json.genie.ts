import { livestoreBaseTsconfigCompilerOptions, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    rootDir: '.',
    outDir: 'dist',
  },
  include: ['src'],
})
