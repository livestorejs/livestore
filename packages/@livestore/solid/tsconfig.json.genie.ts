import { packageTsconfigCompilerOptions, solidJsx, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    ...solidJsx,
  },
  include: ['./src'],
  references: [{ path: '../common' }, { path: '../livestore' }, { path: '../utils' }],
})
