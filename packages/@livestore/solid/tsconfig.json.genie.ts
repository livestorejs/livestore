import { packageTsconfigCompilerOptions, refs, solidJsx, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...solidJsx,
  },
  include: ['./src'],
  references: [refs.common, refs.livestore, refs.utils],
})
