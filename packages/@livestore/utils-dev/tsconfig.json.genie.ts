import { livestoreBaseTsconfigCompilerOptions, packageTsconfigCompilerOptions, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
  },
  include: ['./src'],
  references: [],
})
