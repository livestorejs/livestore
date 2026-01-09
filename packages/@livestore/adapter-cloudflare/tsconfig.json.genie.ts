import { packageTsconfigCompilerOptions, refs, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    resolveJsonModule: true,
  },
  include: ['./src'],
  references: [refs.common, refs.utils, refs.livestore, refs.sqliteWasm, refs.syncCf, refs.commonCf],
})
