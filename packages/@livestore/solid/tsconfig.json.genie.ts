import { tsconfigJSON } from '#genie/mod.ts'
import { packageTsconfigCompilerOptions, refs, solidJsx } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...solidJsx,
  },
  include: ['./src'],
  references: [refs.common, refs.livestore, refs.utils],
})
