import { tsconfigJSON } from '#genie/mod.ts'
import { packageTsconfigCompilerOptions, refs } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
  },
  include: ['./src'],
  references: [refs.common, refs.adapterWeb, refs.livestore, refs.utils, refs.utilsDev],
})
