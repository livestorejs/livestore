import { livestoreBaseTsconfigCompilerOptions, packageTsconfigCompilerOptions, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    declaration: true,
    declarationMap: true,
  },
  include: ['src/**/*'],
})
