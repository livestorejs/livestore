import { packageTsconfigCompilerOptions, tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    resolveJsonModule: true,
  },
  include: ['./src'],
  references: [
    { path: '../common' },
    { path: '../utils' },
    { path: '../livestore' },
    { path: '../sqlite-wasm' },
    { path: '../sync-cf' },
    { path: '../common-cf' },
  ],
})
