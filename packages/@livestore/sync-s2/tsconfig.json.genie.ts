import { packageTsconfigCompilerOptions, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    composite: true,
  },
  include: ['./src'],
  references: [{ path: '../common' }, { path: '../utils' }],
})
