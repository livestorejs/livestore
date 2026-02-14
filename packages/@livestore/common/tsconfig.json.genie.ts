import {
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  refs,
  tsconfigJson,
} from '../../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    lib: ['ES2023'], // Needed for `Array.toSorted`
    resolveJsonModule: true,
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.utils, refs.utilsDev, refs.webmesh],
})
