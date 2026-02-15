import {
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    exactOptionalPropertyTypes: false,
    resolveJsonModule: true,
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.utils, refs.utilsDev],
})
