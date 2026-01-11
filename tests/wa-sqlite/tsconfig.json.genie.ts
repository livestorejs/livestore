import { tsconfigJSON } from '#genie/mod.ts'

export default tsconfigJSON({
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    noEmit: true,
  },
  include: ['test'],
  exclude: ['node_modules', '**/dist'],
  references: [{ path: '../../packages/@livestore/wa-sqlite' }],
})
