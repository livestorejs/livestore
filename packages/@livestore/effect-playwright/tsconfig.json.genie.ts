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
    lib: ['ES2024', 'DOM'],
    types: ['node'],
  },
  include: ['./src'],
  exclude: [...packageTsconfigExclude],
  references: [refs.utils],
})
