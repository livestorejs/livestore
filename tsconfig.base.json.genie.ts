import { livestoreBaseTsconfigCompilerOptions, tsconfigExclude, tsconfigJson } from './genie/repo.ts'

export default tsconfigJson({
  compilerOptions: livestoreBaseTsconfigCompilerOptions,
  exclude: tsconfigExclude,
})
