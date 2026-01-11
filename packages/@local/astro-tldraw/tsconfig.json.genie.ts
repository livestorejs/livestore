import { tsconfigJSON } from '#genie/mod.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    rootDir: '.',
    outDir: 'dist',
  },
  include: ['src'],
})
