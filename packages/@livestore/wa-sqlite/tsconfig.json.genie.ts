import { tsconfigJSON } from '#genie/mod.ts'
import { packageTsconfigCompilerOptions } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    declaration: true,
    declarationMap: true,
  },
  include: ['src/**/*'],
})
