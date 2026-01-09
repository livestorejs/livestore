import { tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    rootDir: '.',
    outDir: 'dist',
  },
  include: ['src'],
})
