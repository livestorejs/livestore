import {
  baseTsconfigCompilerOptions,
  domLib,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    lib: [...domLib],
    resolveJsonModule: true,
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.utils, refs.utilsDev],
})
