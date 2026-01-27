import { baseTsconfigCompilerOptions, tsconfigJson } from '../../../../../../../genie/repo.ts'

/**
 * Test fixture tsconfig for catalog tests.
 * Non-composite (noEmit) since these are just test fixtures.
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    rootDir: './',
    types: ['vite/client'],
    noEmit: true,
  },
  include: ['./**/*.ts', './**/*.tsx', './**/*.d.ts'],
})
