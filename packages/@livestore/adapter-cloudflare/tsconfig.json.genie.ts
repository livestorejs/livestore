import {
  livestoreBaseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    resolveJsonModule: true,
  },
  include: ['./src'],
  references: [refs.common, refs.utils, refs.livestore, refs.sqliteWasm, refs.syncCf, refs.commonCf],
})
