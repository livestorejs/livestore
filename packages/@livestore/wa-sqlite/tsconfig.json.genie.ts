import {
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    declaration: true,
    declarationMap: true,
  },
  include: ['src/**/*'],
  exclude: [...packageTsconfigExclude],
})
