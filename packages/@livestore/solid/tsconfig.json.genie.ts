import {
  baseTsconfigCompilerOptions,
  domLib,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  refs,
  solidJsx,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    lib: domLib,
    ...solidJsx,
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.adapterWeb, refs.common, refs.frameworkToolkit, refs.livestore, refs.utils, refs.utilsDev],
})
