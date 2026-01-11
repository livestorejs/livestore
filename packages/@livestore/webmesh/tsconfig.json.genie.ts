import { tsconfigJSON } from '#genie/mod.ts'
import { packageTsconfigCompilerOptions, refs } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    exactOptionalPropertyTypes: false,
    resolveJsonModule: true,
  },
  include: ['./src'],
  references: [refs.utils, refs.utilsDev],
})
