import { livestoreBaseTsconfigCompilerOptions, packageTsconfigCompilerOptions, refs, tsconfigJson } from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...livestoreBaseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    lib: ['ES2023'], // Needed for `Array.toSorted`
    resolveJsonModule: true,
  },
  include: ['./src'],
  references: [refs.utils, refs.utilsDev, refs.webmesh],
})
