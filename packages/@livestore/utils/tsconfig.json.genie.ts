import {
  baseTsconfigCompilerOptions,
  domLib,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    lib: [...domLib],
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [],
})
