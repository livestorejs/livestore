import { tsconfigJSON } from '#genie/mod.ts'
import { packageTsconfigCompilerOptions, refs } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    ...packageTsconfigCompilerOptions,
    lib: ['ES2023'], // Needed for `Array.toSorted`
    resolveJsonModule: true,
  },
  include: ['./src'],
  references: [refs.utils, refs.utilsDev, refs.webmesh],
})
